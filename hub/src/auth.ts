/**
 * Server-side check of a Cloudflare Access session.
 *
 * Cloudflare Access (free Zero Trust plan) does the sign-in and keeps the session in an HttpOnly,
 * Secure cookie on the hub hostname. On every request it forwards a signed JWT to the Worker in
 * the Cf-Access-Jwt-Assertion header. This module verifies that JWT itself, so the Worker refuses
 * requests that did not come through Access: direct workers.dev hits, other hostnames, a
 * misconfigured Access policy, or a forged header.
 *
 * Checks: RS256 signature against the team's published keys, issuer, audience (this Access
 * application only), expiry and not-before, and the email against the allow list.
 */

export type AuthResult =
  | { ok: true; email: string }
  | { ok: false; reason: "missing" | "invalid" | "expired" | "forbidden" | "unavailable" | "not_configured" };

export interface AuthConfig {
  teamDomain?: string; // e.g. "yourteam.cloudflareaccess.com"
  aud?: string; // the Access application's Audience (AUD) tag
  allowedEmails?: string; // comma-separated
}

interface Jwk {
  kid: string;
  kty: string;
  n: string;
  e: string;
  alg?: string;
}

export interface CertCache {
  keys?: Jwk[];
  domain?: string;
  expires?: number;
}

const SKEW_SECONDS = 60;
const CERT_TTL_MS = 60 * 60 * 1000;
const MAX_TOKEN_CHARS = 8192;

function b64urlToBytes(s: string): Uint8Array {
  const pad = s.length % 4 === 0 ? "" : "=".repeat(4 - (s.length % 4));
  const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/") + pad);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function decodeJson(part: string): Record<string, unknown> | null {
  try {
    const v = JSON.parse(new TextDecoder().decode(b64urlToBytes(part)));
    return v && typeof v === "object" ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function normalizeDomain(d: string): string {
  return d.trim().replace(/^https?:\/\//, "").replace(/\/+$/, "").toLowerCase();
}

async function loadKeys(domain: string, cache: CertCache, fetchImpl: typeof fetch, now: number, force = false): Promise<Jwk[] | null> {
  if (!force && cache.keys && cache.domain === domain && (cache.expires ?? 0) > now) return cache.keys;
  try {
    const res = await fetchImpl(`https://${domain}/cdn-cgi/access/certs`, { headers: { accept: "application/json" } });
    if (!res.ok) return null;
    const body = (await res.json()) as { keys?: Jwk[] };
    if (!Array.isArray(body.keys) || body.keys.length === 0) return null;
    cache.keys = body.keys;
    cache.domain = domain;
    cache.expires = now + CERT_TTL_MS;
    return body.keys;
  } catch {
    return null;
  }
}

export async function verifyAccess(
  token: string | null,
  config: AuthConfig,
  opts: { fetchImpl: typeof fetch; now: Date; cache: CertCache },
): Promise<AuthResult> {
  const domain = config.teamDomain ? normalizeDomain(config.teamDomain) : "";
  const aud = config.aud?.trim() ?? "";
  const allowed = (config.allowedEmails ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  // Fail closed when setup is incomplete.
  if (!domain || !aud || allowed.length === 0) return { ok: false, reason: "not_configured" };
  if (!token) return { ok: false, reason: "missing" };
  if (token.length > MAX_TOKEN_CHARS) return { ok: false, reason: "invalid" };

  const parts = token.split(".");
  if (parts.length !== 3) return { ok: false, reason: "invalid" };
  const header = decodeJson(parts[0]);
  const payload = decodeJson(parts[1]);
  if (!header || !payload || header.alg !== "RS256" || typeof header.kid !== "string") return { ok: false, reason: "invalid" };

  const nowMs = opts.now.getTime();
  let keys = await loadKeys(domain, opts.cache, opts.fetchImpl, nowMs);
  if (!keys) return { ok: false, reason: "unavailable" };
  let jwk = keys.find((k) => k.kid === header.kid);
  if (!jwk) {
    // Access rotates keys; refresh once before calling the token bad.
    keys = await loadKeys(domain, opts.cache, opts.fetchImpl, nowMs, true);
    if (!keys) return { ok: false, reason: "unavailable" };
    jwk = keys.find((k) => k.kid === header.kid);
    if (!jwk) return { ok: false, reason: "invalid" };
  }

  let valid = false;
  try {
    const key = await crypto.subtle.importKey("jwk", { kty: jwk.kty, n: jwk.n, e: jwk.e, alg: "RS256", ext: true }, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
    valid = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, b64urlToBytes(parts[2]), new TextEncoder().encode(`${parts[0]}.${parts[1]}`));
  } catch {
    valid = false;
  }
  if (!valid) return { ok: false, reason: "invalid" };

  if (payload.iss !== `https://${domain}`) return { ok: false, reason: "invalid" };
  const auds = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  if (!auds.includes(aud)) return { ok: false, reason: "invalid" };
  if (payload.type !== undefined && payload.type !== "app") return { ok: false, reason: "invalid" };

  const nowS = Math.floor(nowMs / 1000);
  if (typeof payload.exp !== "number" || payload.exp + SKEW_SECONDS < nowS) return { ok: false, reason: "expired" };
  if (typeof payload.nbf === "number" && payload.nbf - SKEW_SECONDS > nowS) return { ok: false, reason: "invalid" };

  const email = typeof payload.email === "string" ? payload.email.trim().toLowerCase() : "";
  if (!email || !allowed.includes(email)) return { ok: false, reason: "forbidden" };
  return { ok: true, email };
}
