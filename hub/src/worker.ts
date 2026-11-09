/**
 * Jake's private hub, stage 1A. A separate Cloudflare Worker, never part of the GitHub Pages build.
 *
 *   GET /            the hub page (server-rendered)
 *   GET /api/today   the same view as JSON
 *   GET /hub.css, /hub.js
 *
 * Every route, including static assets and 404s, requires a verified Cloudflare Access session.
 * Nothing private is computed before that check passes. All responses are no-store.
 *
 * Stage 1A has no live sources. HUB_DATA_MODE=fixture serves invented data; anything else reports
 * every source as "not connected".
 */
import { verifyAccess, type CertCache } from "./auth";
import { buildToday, type HubFeeds } from "./contract";
import { FIXTURE_SCENARIOS, fixtureFeeds, type FixtureScenario } from "./fixtures";
import { HUB_CSS, HUB_JS, errorInfo, renderError, renderPage, type ErrorKind } from "./render";

export interface HubEnv {
  /** Cloudflare Access team domain, e.g. "yourteam.cloudflareaccess.com". Set in the dashboard. */
  ACCESS_TEAM_DOMAIN?: string;
  /** Audience (AUD) tag of the hub's Access application. Set as a secret in the dashboard. */
  ACCESS_AUD?: string;
  /** Comma-separated emails allowed in. Set as a secret in the dashboard. */
  ALLOWED_EMAILS?: string;
  /** "fixture" to serve synthetic data. Unset in production until stage 1B. */
  HUB_DATA_MODE?: string;
  HUB_FIXTURE?: string;
  /** Optional Workers rate limiting binding (see wrangler.toml). */
  RATE_LIMITER?: { limit: (opts: { key: string }) => Promise<{ success: boolean }> };
}

export interface HubDeps {
  fetchImpl?: typeof fetch;
  now?: () => Date;
  certCache?: CertCache;
  /** Test hook: replace the feed loader. */
  loadFeeds?: (env: HubEnv, now: Date) => Promise<HubFeeds>;
}

const MAX_URL_CHARS = 2048;
const sharedCache: CertCache = {};

const BASE_HEADERS: Record<string, string> = {
  "cache-control": "private, no-store, max-age=0",
  pragma: "no-cache",
  vary: "Cookie, Cf-Access-Jwt-Assertion",
  "x-content-type-options": "nosniff",
  "referrer-policy": "no-referrer",
  "x-frame-options": "DENY",
  "x-robots-tag": "noindex, nofollow",
  "permissions-policy": "camera=(), microphone=(), geolocation=()",
  "content-security-policy":
    "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'self'; form-action 'none'; base-uri 'none'; frame-ancestors 'none'",
};

function respond(body: string | null, status: number, type: string): Response {
  return new Response(body, { status, headers: { ...BASE_HEADERS, ...(body !== null ? { "content-type": type } : {}) } });
}

function fail(kind: ErrorKind, wantsJson: boolean): Response {
  const info = errorInfo(kind);
  if (wantsJson) return respond(JSON.stringify({ error: kind, message: info.text }), info.status, "application/json; charset=utf-8");
  return respond(renderError(kind), info.status, "text/html; charset=utf-8");
}

async function defaultFeeds(env: HubEnv, now: Date): Promise<HubFeeds> {
  if (env.HUB_DATA_MODE === "fixture") {
    const s = (FIXTURE_SCENARIOS as readonly string[]).includes(env.HUB_FIXTURE ?? "") ? (env.HUB_FIXTURE as FixtureScenario) : "normal";
    return fixtureFeeds(s, now);
  }
  return fixtureFeeds("not_connected", now);
}

export async function handle(req: Request, env: HubEnv, deps: HubDeps = {}): Promise<Response> {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const now = (deps.now ?? (() => new Date()))();
  if (req.url.length > MAX_URL_CHARS) return respond("Request too long.", 414, "text/plain; charset=utf-8");
  const url = new URL(req.url);
  const wantsJson = url.pathname.startsWith("/api/");
  if (req.method !== "GET" && req.method !== "HEAD") {
    return new Response("Method not allowed.", { status: 405, headers: { ...BASE_HEADERS, allow: "GET, HEAD", "content-type": "text/plain; charset=utf-8" } });
  }

  if (env.RATE_LIMITER) {
    const ip = req.headers.get("cf-connecting-ip") ?? "unknown";
    const { success } = await env.RATE_LIMITER.limit({ key: ip });
    if (!success) return fail("rate_limited", wantsJson);
  }

  const auth = await verifyAccess(
    req.headers.get("cf-access-jwt-assertion"),
    { teamDomain: env.ACCESS_TEAM_DOMAIN, aud: env.ACCESS_AUD, allowedEmails: env.ALLOWED_EMAILS },
    { fetchImpl, now, cache: deps.certCache ?? sharedCache },
  );
  if (!auth.ok) {
    const map: Record<typeof auth.reason, ErrorKind> = {
      missing: "signed_out",
      invalid: "signed_out",
      expired: "expired",
      forbidden: "forbidden",
      unavailable: "auth_down",
      not_configured: "not_configured",
    };
    return fail(map[auth.reason], wantsJson);
  }

  // Authenticated from here on.
  if (url.pathname === "/hub.css") return respond(HUB_CSS, 200, "text/css; charset=utf-8");
  if (url.pathname === "/hub.js") return respond(HUB_JS, 200, "text/javascript; charset=utf-8");
  if (url.pathname !== "/" && url.pathname !== "/api/today") return fail("not_found", wantsJson);

  let view;
  try {
    const feeds = await (deps.loadFeeds ?? defaultFeeds)(env, now);
    view = buildToday(feeds, now);
  } catch {
    // Generic message; no internals.
    return fail("data_down", wantsJson);
  }
  if (url.pathname === "/api/today") return respond(JSON.stringify(view), 200, "application/json; charset=utf-8");
  return respond(renderPage(view, auth.email), 200, "text/html; charset=utf-8");
}

export default { fetch: (req: Request, env: HubEnv) => handle(req, env) };
