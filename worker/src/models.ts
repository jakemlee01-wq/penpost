/**
 * The two model clients. Each call returns text plus token counts and dollar cost, so the
 * orchestrator can log every call and enforce the per-project cap.
 */
import Anthropic from "@anthropic-ai/sdk";
import type { Env } from "./env";

export type Role = "A" | "B";
export type Provider = "anthropic" | "gemini";

export interface ModelConfig {
  role: Role;
  provider: Provider;
  model: string;
  priceIn: number; // USD per million tokens
  priceOut: number;
}

export interface ModelCall {
  system: string;
  prompt: string;
  maxTokens: number;
}

export interface ModelResult {
  text: string;
  tokensIn: number;
  tokensOut: number;
  costUsd: number;
}

export type ModelCaller = (cfg: ModelConfig, call: ModelCall) => Promise<ModelResult>;

export class ModelError extends Error {}

/** Anthropic models that accept the server-side refusal fallback. */
const SERVER_FALLBACK_MODELS = new Set(["claude-fable-5-2", "claude-fable-5-1", "claude-opus-5-5", "claude-opus-5", "claude-sonnet-5-5"]);

export function modelConfig(env: Env, role: Role): ModelConfig {
  const p = role === "A" ? "MODEL_A" : "MODEL_B";
  const provider = (env[`${p}_PROVIDER`] ?? (role === "A" ? "anthropic" : "gemini")) as Provider;
  return {
    role,
    provider,
    model: env[p] ?? (provider === "anthropic" ? "claude-haiku-5-5" : "gemini-3.8-flash"),
    priceIn: Number(env[`${p}_PRICE_IN`] ?? (provider === "anthropic" ? 0.1 : 1.5)),
    priceOut: Number(env[`${p}_PRICE_OUT`] ?? (provider === "anthropic" ? 0.5 : 7.5)),
  };
}

export function cost(cfg: ModelConfig, tokensIn: number, tokensOut: number): number {
  return (tokensIn * cfg.priceIn + tokensOut * cfg.priceOut) / 1_000_000;
}

/** Real API calls. Tests pass their own ModelCaller instead. */
export function liveCaller(env: Env): ModelCaller {
  return async (cfg, call) => {
    if (cfg.provider === "anthropic") return callAnthropic(env, cfg, call);
    if (cfg.provider === "gemini") return callGemini(env, cfg, call);
    throw new ModelError(`unknown provider ${cfg.provider as string}`);
  };
}

async function callAnthropic(env: Env, cfg: ModelConfig, call: ModelCall): Promise<ModelResult> {
  if (!env.ANTHROPIC_API_KEY) throw new ModelError("ANTHROPIC_API_KEY is not set");
  const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY, maxRetries: 2 });
  const effort = (env.ANTHROPIC_EFFORT ?? "high") as "low" | "medium" | "high" | "xhigh" | "max";
  const res = await client.beta.messages
    .stream({
      model: cfg.model,
      max_tokens: call.maxTokens,
      system: call.system,
      messages: [{ role: "user", content: call.prompt }],
      thinking: { type: "adaptive" },
      output_config: { effort },
      // On a safety decline, let the API re-run the request on its default fallback model.
      // Only some models accept server-side fallbacks (Haiku does not), so send it only for those.
      ...(SERVER_FALLBACK_MODELS.has(cfg.model)
        ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const }
        : {}),
    })
    .finalMessage();
  const tokensIn =
    res.usage.input_tokens + (res.usage.cache_creation_input_tokens ?? 0) + (res.usage.cache_read_input_tokens ?? 0);
  const tokensOut = res.usage.output_tokens;
  if (res.stop_reason === "refusal") throw new ModelError("Model A declined the request");
  if (res.stop_reason === "max_tokens") throw new ModelError("Model A hit the output limit");
  const text = res.content.map((b) => (b.type === "text" ? b.text : "")).join("");
  return { text, tokensIn, tokensOut, costUsd: cost(cfg, tokensIn, tokensOut) };
}

async function callGemini(env: Env, cfg: ModelConfig, call: ModelCall): Promise<ModelResult> {
  if (!env.GEMINI_API_KEY) throw new ModelError("GEMINI_API_KEY is not set");
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(cfg.model)}:generateContent`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", "x-goog-api-key": env.GEMINI_API_KEY },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: call.system }] },
      contents: [{ role: "user", parts: [{ text: call.prompt }] }],
      generationConfig: { maxOutputTokens: call.maxTokens, responseMimeType: "application/json" },
    }),
  });
  if (!res.ok) throw new ModelError(`Gemini ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const data = (await res.json()) as {
    candidates?: { content?: { parts?: { text?: string }[] }; finishReason?: string }[];
    usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number; thoughtsTokenCount?: number };
  };
  const tokensIn = data.usageMetadata?.promptTokenCount ?? 0;
  const tokensOut = (data.usageMetadata?.candidatesTokenCount ?? 0) + (data.usageMetadata?.thoughtsTokenCount ?? 0);
  const cand = data.candidates?.[0];
  if (cand?.finishReason === "MAX_TOKENS") throw new ModelError("Model B hit the output limit");
  const text = (cand?.content?.parts ?? []).map((p) => p.text ?? "").join("");
  if (!text) throw new ModelError(`Model B returned nothing (${cand?.finishReason ?? "no candidate"})`);
  return { text, tokensIn, tokensOut, costUsd: cost(cfg, tokensIn, tokensOut) };
}

/** Pull the first JSON object out of a model reply (tolerates code fences and chatter). */
export function parseJson<T>(text: string): T {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) throw new ModelError("reply had no JSON object");
  try {
    return JSON.parse(text.slice(start, end + 1)) as T;
  } catch {
    throw new ModelError("reply JSON did not parse");
  }
}
