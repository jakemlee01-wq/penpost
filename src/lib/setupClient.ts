import type { Areas } from "./areas";
import { finalizeSetup, localParse, MAX_SETUP_CHARS, sanitizeParsed, type ParsedSetup, type SetupResult } from "./setupParse";

/** Set at build time, e.g. VITE_PARSE_URL=https://penpost-setup.<account>.workers.dev/parse */
const PARSE_URL: string = (import.meta.env?.VITE_PARSE_URL as string | undefined) ?? "";

/** True when the build points at the Worker, so the setup screen can say the answer goes to an AI model. */
export const parserConfigured = Boolean(PARSE_URL);

type Options = { url?: string; fetchImpl?: typeof fetch; timeoutMs?: number };

/** Ask the Worker. Any failure (not configured, offline, slow, bad reply) returns null. */
async function askWorker(text: string, areas: Areas, { url = PARSE_URL, fetchImpl = fetch, timeoutMs = 8000 }: Options): Promise<ParsedSetup | null> {
  if (!url) return null;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetchImpl(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text }),
      signal: ctrl.signal,
    });
    if (!res.ok) return null;
    return sanitizeParsed(await res.json(), areas);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Worker first, then the in-browser parser, then the starter default.
 * Setup never fails: the reader always lands on an edition.
 */
export async function runSetup(rawText: string, areas: Areas, opts: Options = {}): Promise<SetupResult> {
  const text = rawText.trim().slice(0, MAX_SETUP_CHARS);
  if (!text) return finalizeSetup({ areas: [], interests: [], likes: [], avoids: [] }, "basic");
  const ai = await askWorker(text, areas, opts);
  if (ai && ai.interests.length) return finalizeSetup(ai, "ai");
  const basic = localParse(text, areas);
  if (basic.interests.length || !ai) return finalizeSetup(basic, "basic");
  return finalizeSetup(ai, "ai");
}
