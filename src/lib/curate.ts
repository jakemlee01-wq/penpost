/**
 * Client side of on-demand editions ("See today's paper").
 *
 * The Worker URL comes from the build: VITE_CURATE_URL if set, otherwise the setup Worker's
 * VITE_PARSE_URL with /parse swapped for /curate. With neither, there is no button and the app
 * shows whatever editions are bundled, as before.
 *
 * Stories are bundled at build time, so "ready" means the stories are deployed. The Worker
 * answers with readyAt (when the last topic finished); this bundle knows when it was built.
 * A bundle built after readyAt has the stories. An older one reloads.
 */

declare const __PENPOST_BUILD_TIME__: string | undefined;

const env = (import.meta.env ?? {}) as Record<string, string | undefined>;

export function curateBase(parseUrl = env.VITE_PARSE_URL ?? "", curateUrl = env.VITE_CURATE_URL ?? ""): string {
  if (curateUrl) return curateUrl.replace(/\/+$/, "").replace(/\/curate$/, "");
  if (/\/parse\/?$/.test(parseUrl)) return parseUrl.replace(/\/parse\/?$/, "");
  return "";
}

const BASE = curateBase();
export const curateConfigured = Boolean(BASE);

/** When this bundle was built (ISO). Empty in tests and dev without the define. */
export const BUILD_TIME: string = typeof __PENPOST_BUILD_TIME__ === "string" ? __PENPOST_BUILD_TIME__ : "";

/** How long the curating screen waits before showing the latest edition instead. */
export const CURATE_TIMEOUT_MS = 5 * 60 * 1000;
export const POLL_MS = 12_000;
/** A run takes a few seconds to appear after dispatch; don't call it failed before this. */
export const GRACE_MS = 45_000;

export type CurateReply =
  | { status: "ready"; readyAt: string; ready: number; total: number; failed?: string[] }
  | { status: "generating"; pending: string[]; ready: number; total: number }
  | { status: "failed"; failed: string[]; ready: number; total: number }
  /** Rate limited or a passing network error: keep waiting. */
  | { status: "busy" }
  /** The Worker refused or isn't set up: fall back now. */
  | { status: "error" };

type Opts = { base?: string; fetchImpl?: typeof fetch; timeoutMs?: number };

async function call(path: string, init: RequestInit, { base = BASE, fetchImpl = fetch, timeoutMs = 15_000 }: Opts): Promise<CurateReply> {
  if (!base) return { status: "error" };
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetchImpl(`${base}${path}`, { ...init, signal: ctrl.signal, cache: "no-store" });
    if (res.status === 429 || res.status >= 500) return res.status === 503 ? { status: "error" } : { status: "busy" };
    if (!res.ok) return { status: "error" };
    const body = (await res.json()) as CurateReply;
    return ["ready", "generating", "failed"].includes(body?.status) ? body : { status: "error" };
  } catch {
    return { status: "busy" };
  } finally {
    clearTimeout(timer);
  }
}

/** Ask for today's paper. The Worker starts generation for topics nobody has asked for yet. */
export function requestPaper(date: string, topics: string[], opts: Opts = {}): Promise<CurateReply> {
  return call("/curate", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ date, topics }) }, opts);
}

export function paperStatus(date: string, topics: string[], opts: Opts = {}): Promise<CurateReply> {
  const q = new URLSearchParams({ date, topics: topics.join(",") });
  return call(`/curate/status?${q}`, { method: "GET" }, opts);
}

/** Does this bundle already have stories that finished at readyAt? */
export function bundleHas(readyAt: string, buildTime = BUILD_TIME): boolean {
  if (!readyAt) return true;
  if (!buildTime) return false;
  return buildTime >= readyAt;
}

/** Load the newest build. The query string gets past the 10-minute page cache on GitHub Pages. */
export function reloadFresh(loc: Pick<Location, "pathname" | "hash" | "replace"> = window.location): void {
  loc.replace(`${loc.pathname}?fresh=${Date.now()}${loc.hash}`);
}

export const FALLBACK_NOTICE = "Today's paper is still being put together. Here is your latest.";
