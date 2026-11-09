/** Test-only Access stand-in: a local RSA key, a fake certs endpoint and a JWT signer. */
import type { HubEnv } from "../hub/src/worker";

export const TEAM = "test-team.cloudflareaccess.com";
export const AUD = "test-aud-0001";
export const OWNER = "owner@example.com";
export const NOW = new Date("2026-11-09T16:30:00Z"); // 10:30 AM in Chicago

export const env: HubEnv = { ACCESS_TEAM_DOMAIN: TEAM, ACCESS_AUD: AUD, ALLOWED_EMAILS: OWNER, HUB_DATA_MODE: "fixture" };

function b64url(bytes: Uint8Array | string): string {
  const b = typeof bytes === "string" ? new TextEncoder().encode(bytes) : bytes;
  let s = "";
  for (const x of b) s += String.fromCharCode(x);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export interface KeyPair {
  kid: string;
  privateKey: CryptoKey;
  jwk: JsonWebKey & { kid: string };
}

export async function makeKey(kid = "k1"): Promise<KeyPair> {
  const pair = (await crypto.subtle.generateKey(
    { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
    true,
    ["sign", "verify"],
  )) as CryptoKeyPair;
  const jwk = (await crypto.subtle.exportKey("jwk", pair.publicKey)) as JsonWebKey;
  return { kid, privateKey: pair.privateKey, jwk: { ...jwk, kid } };
}

export async function sign(key: KeyPair, claims: Record<string, unknown>, header: Record<string, unknown> = {}): Promise<string> {
  const h = b64url(JSON.stringify({ alg: "RS256", kid: key.kid, typ: "JWT", ...header }));
  const p = b64url(JSON.stringify(claims));
  const sig = new Uint8Array(await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key.privateKey, new TextEncoder().encode(`${h}.${p}`)));
  return `${h}.${p}.${b64url(sig)}`;
}

export function claims(over: Record<string, unknown> = {}): Record<string, unknown> {
  const t = Math.floor(NOW.getTime() / 1000);
  return { iss: `https://${TEAM}`, aud: [AUD], email: OWNER, type: "app", iat: t - 60, nbf: t - 60, exp: t + 3600, sub: "fixture-user", ...over };
}

export function certsFetch(keys: KeyPair[], opts: { down?: boolean } = {}) {
  const calls: string[] = [];
  const f = (async (input: RequestInfo | URL) => {
    const u = String(input);
    calls.push(u);
    if (opts.down) throw new Error("network down");
    if (u !== `https://${TEAM}/cdn-cgi/access/certs`) return new Response("nope", { status: 404 });
    return new Response(JSON.stringify({ keys: keys.map((k) => k.jwk) }), { status: 200 });
  }) as unknown as typeof fetch;
  return { f, calls };
}

export function req(path: string, token?: string, init: { host?: string; method?: string } = {}): Request {
  const headers: Record<string, string> = {};
  if (token) headers["cf-access-jwt-assertion"] = token;
  return new Request(`https://${init.host ?? "hub.example.com"}${path}`, { method: init.method ?? "GET", headers });
}
