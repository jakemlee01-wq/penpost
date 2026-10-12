/**
 * One small interface for every model call, so the provider is a setting.
 *
 *   PENPOST_PROVIDER = gemini | anthropic | mock     (default: gemini)
 *   GEMINI_API_KEY / ANTHROPIC_API_KEY               (from GitHub Actions secrets)
 *   PENPOST_TRIAGE_MODEL                             cheap, fast model for sorting candidates
 *   PENPOST_WRITER_MODEL                             stronger model for fact extraction, drafting, checking
 *   PENPOST_MAX_CALLS                                hard cap on model calls per run (default 40)
 *   PENPOST_FALLBACK_MODEL                           Gemini model to switch to if the writer model stays
 *                                                    rate limited (default: the triage model)
 *
 * Model names change often. Check the provider's current model list and set
 * the two model variables in the workflow rather than editing code.
 */

export type Tier = "triage" | "writer";
export type Call = { tier: Tier; system: string; prompt: string; json?: boolean; temperature?: number };
export type Usage = { calls: number; inputTokens: number; outputTokens: number };
export type Model = { complete(call: Call): Promise<string>; usage: Usage };

const DEFAULT_MODELS: Record<string, Record<Tier, string>> = {
  gemini: { triage: "gemini-3.5-flash-lite", writer: "gemini-3.8-flash" },
  anthropic: { triage: "claude-haiku-5-5", writer: "claude-sonnet-5-5" },
};

export function createModel(env: NodeJS.ProcessEnv = process.env, mockResponder?: (call: Call) => string): Model {
  const provider = (env.PENPOST_PROVIDER || "gemini").toLowerCase();
  const maxCalls = Number(env.PENPOST_MAX_CALLS || 40);
  const usage: Usage = { calls: 0, inputTokens: 0, outputTokens: 0 };
  const modelFor = (tier: Tier) =>
    // GitHub Actions passes unset repo variables as "", so treat empty as unset.
    (tier === "triage" ? env.PENPOST_TRIAGE_MODEL : env.PENPOST_WRITER_MODEL) || DEFAULT_MODELS[provider]?.[tier] || "";

  async function guarded(_call: Call, run: () => Promise<string>) {
    if (usage.calls >= maxCalls) throw new Error(`Budget stop: reached PENPOST_MAX_CALLS=${maxCalls}`);
    usage.calls++;
    return run();
  }

  if (provider === "mock") {
    if (!mockResponder) throw new Error("mock provider needs a responder");
    return { usage, complete: (call) => guarded(call, async () => mockResponder(call)) };
  }

  if (provider === "gemini") {
    const key = env.GEMINI_API_KEY;
    if (!key) throw new Error("GEMINI_API_KEY is not set");
    const fallback = env.PENPOST_FALLBACK_MODEL || modelFor("triage");
    // Once the writer model is rate limited, stay on the fallback for the rest of the run
    // instead of waiting out the limit on every call.
    let writerOverride: string | undefined;
    const callGemini = (model: string, call: Call) =>
      fetchWithRetry(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-goog-api-key": key },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: call.system }] },
          contents: [{ role: "user", parts: [{ text: call.prompt }] }],
          generationConfig: {
            temperature: call.temperature ?? 0.4,
            ...(call.json ? { responseMimeType: "application/json" } : {}),
          },
        }),
      });
    return {
      usage,
      complete: (call) =>
        guarded(call, async () => {
          let model = (call.tier === "writer" && writerOverride) || modelFor(call.tier);
          let res: Response;
          try {
            res = await callGemini(model, call);
          } catch (e) {
            if (!(e instanceof RateLimitError) || model === fallback) throw e;
            console.log(`${model} is rate limited (${e.message.slice(0, 200)}); switching to ${fallback}`);
            if (call.tier === "writer") writerOverride = fallback;
            model = fallback;
            res = await callGemini(model, call);
          }
          const data = (await res.json()) as {
            candidates?: { content?: { parts?: { text?: string }[] } }[];
            usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
          };
          usage.inputTokens += data.usageMetadata?.promptTokenCount ?? 0;
          usage.outputTokens += data.usageMetadata?.candidatesTokenCount ?? 0;
          const text = data.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
          if (!text) throw new Error(`Gemini returned no text (${model})`);
          return text;
        }),
    };
  }

  if (provider === "anthropic") {
    const key = env.ANTHROPIC_API_KEY;
    if (!key) throw new Error("ANTHROPIC_API_KEY is not set");
    return {
      usage,
      complete: (call) =>
        guarded(call, async () => {
          const res = await fetchWithRetry("https://api.anthropic.com/v1/messages", {
            method: "POST",
            headers: { "content-type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
            body: JSON.stringify({
              model: modelFor(call.tier),
              max_tokens: 2000,
              temperature: call.temperature ?? 0.4,
              // Cache the long, identical-every-day system prompt (writer cards, rules).
              system: [{ type: "text", text: call.system, cache_control: { type: "ephemeral" } }],
              messages: [{ role: "user", content: call.prompt + (call.json ? "\n\nRespond with JSON only." : "") }],
            }),
          });
          const data = (await res.json()) as { content?: { text?: string }[]; usage?: { input_tokens?: number; output_tokens?: number } };
          usage.inputTokens += data.usage?.input_tokens ?? 0;
          usage.outputTokens += data.usage?.output_tokens ?? 0;
          return data.content?.map((c) => c.text ?? "").join("") ?? "";
        }),
    };
  }

  throw new Error(`Unknown PENPOST_PROVIDER "${provider}"`);
}

export class RateLimitError extends Error {}

/** Seconds the provider asked us to wait, from Gemini's RetryInfo or a Retry-After header. */
function retryAfterSeconds(res: Response, body: string): number | undefined {
  const m = body.match(/"retryDelay"\s*:\s*"(\d+(?:\.\d+)?)s"/);
  if (m) return Number(m[1]);
  const h = Number(res.headers.get("retry-after"));
  return Number.isFinite(h) && h > 0 ? h : undefined;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function fetchWithRetry(url: string, init: RequestInit, tries = 5): Promise<Response> {
  let last: Error = new Error("no attempt made");
  for (let i = 0; i < tries; i++) {
    let res: Response;
    try {
      res = await fetch(url, init);
    } catch (e) {
      last = e instanceof Error ? e : new Error(String(e));
      await sleep(1500 * (i + 1));
      continue;
    }
    if (res.ok) return res;
    const body = (await res.text()).slice(0, 2000);
    const detail = `HTTP ${res.status}: ${body.replace(/\s+/g, " ").slice(0, 400)}`;
    if (res.status === 429) {
      last = new RateLimitError(detail);
      // A daily quota will not reset by waiting a minute; give up so the caller can fall back.
      if (/PerDay/i.test(body)) throw last;
    } else if (res.status >= 500) {
      last = new Error(detail);
    } else {
      throw new Error(detail);
    }
    if (i < tries - 1) await sleep(Math.min(65, Math.max(retryAfterSeconds(res, body) ?? 0, 2 * (i + 1))) * 1000);
  }
  throw last;
}

/** Pull a JSON value out of a model reply, tolerating code fences. */
export function parseJson<T>(text: string): T {
  const cleaned = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "");
  return JSON.parse(cleaned) as T;
}
