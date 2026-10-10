/**
 * Penpost setup parser: a tiny Cloudflare Worker that holds the second Gemini key.
 *
 *   POST /parse   {"text": "I live in the Twin Cities and follow startups..."}
 *   -> 200        {"areas": [...], "interests": [...], "likes": [...], "avoids": [...]}
 *
 * The static site can't keep a key secret, so it sends the reader's setup answer here.
 * The Worker asks Gemini to map it onto Penpost's catalog, then runs the same sanitizer the
 * site uses, so only real area IDs, real sections and clean phrases come back.
 * Nothing is stored. Requests from other websites are refused.
 */
import areasJson from "../../content/areas.json";
import { AreasSchema } from "../../src/lib/areas";
import { MAX_SETUP_CHARS, parseSystemPrompt, parseUserPrompt, sanitizeParsed } from "../../src/lib/setupParse";

export interface Env {
  /** Secret: `npx wrangler secret put GEMINI_API_KEY`. Use a separate key from the daily job. */
  GEMINI_API_KEY: string;
  /** Comma-separated list of sites allowed to call this Worker. */
  ALLOWED_ORIGINS?: string;
  GEMINI_MODEL?: string;
  /** Optional Cloudflare rate-limit binding (see wrangler.toml). */
  RATE_LIMITER?: { limit: (opts: { key: string }) => Promise<{ success: boolean }> };
}

const areas = AreasSchema.parse(areasJson);
const SYSTEM = parseSystemPrompt(areas);
const DEFAULT_ORIGINS = "https://penpost.co,https://www.penpost.co,https://jakemlee01-wq.github.io,http://localhost:5173";

function cors(origin: string): Record<string, string> {
  return {
    "access-control-allow-origin": origin,
    "access-control-allow-methods": "POST, OPTIONS",
    "access-control-allow-headers": "content-type",
    "access-control-max-age": "86400",
    vary: "Origin",
  };
}

function json(body: unknown, status: number, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
}

export async function handle(req: Request, env: Env, fetchImpl: typeof fetch = fetch): Promise<Response> {
  const url = new URL(req.url);
  const origin = req.headers.get("origin") ?? "";
  const allowed = (env.ALLOWED_ORIGINS || DEFAULT_ORIGINS).split(",").map((s) => s.trim());
  if (!allowed.includes(origin)) return json({ error: "origin not allowed" }, 403);
  const headers = cors(origin);

  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers });
  if (url.pathname !== "/parse") return json({ error: "not found" }, 404, headers);
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405, headers);

  if (env.RATE_LIMITER) {
    const ip = req.headers.get("cf-connecting-ip") ?? "unknown";
    const { success } = await env.RATE_LIMITER.limit({ key: ip });
    if (!success) return json({ error: "too many requests" }, 429, headers);
  }

  let text = "";
  try {
    const body = (await req.json()) as { text?: unknown };
    text = typeof body.text === "string" ? body.text.trim() : "";
  } catch {
    return json({ error: "expected JSON" }, 400, headers);
  }
  if (!text) return json({ error: "text is required" }, 400, headers);
  if (text.length > MAX_SETUP_CHARS * 2) return json({ error: "text is too long" }, 413, headers);
  if (!env.GEMINI_API_KEY) return json({ error: "parser not configured" }, 503, headers);

  const model = env.GEMINI_MODEL || "gemini-2.5-flash";
  try {
    const res = await fetchImpl(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": env.GEMINI_API_KEY },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: SYSTEM }] },
        contents: [{ role: "user", parts: [{ text: parseUserPrompt(text) }] }],
        generationConfig: { temperature: 0.1, responseMimeType: "application/json", maxOutputTokens: 1024, thinkingConfig: { thinkingBudget: 0 } },
      }),
    });
    if (!res.ok) return json({ error: `model error ${res.status}` }, 502, headers);
    const data = (await res.json()) as { candidates?: { content?: { parts?: { text?: string }[] } }[] };
    const out = data.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
    const parsed = JSON.parse(out.trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, ""));
    return json(sanitizeParsed(parsed, areas), 200, headers);
  } catch {
    return json({ error: "could not read the model reply" }, 502, headers);
  }
}

export default { fetch: (req: Request, env: Env) => handle(req, env) };
