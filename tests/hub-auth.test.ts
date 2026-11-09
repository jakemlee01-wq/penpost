// @vitest-environment node
import { beforeAll, describe, expect, it, vi } from "vitest";
import { handle } from "../hub/src/worker";
import { AUD, NOW, OWNER, certsFetch, claims, env, makeKey, req, sign, type KeyPair } from "./hubHelpers";

let key: KeyPair;
let otherKey: KeyPair;
beforeAll(async () => {
  key = await makeKey("k1");
  otherKey = await makeKey("k-attacker");
});

const run = (r: Request, e = env, keys = () => [key], down = false) => {
  const { f, calls } = certsFetch(keys(), { down });
  return { res: handle(r, e, { fetchImpl: f, now: () => NOW, certCache: {} }), calls };
};

const PRIVATE_MARKERS = ["Today - Mon Nov 9", "Sample invoice is ready to send", "Stand-up with the sample team", "Good morning", "Waiting to hear back", OWNER];

async function expectNoPrivate(res: Response) {
  const text = await res.text();
  for (const m of PRIVATE_MARKERS) expect(text).not.toContain(m);
}

describe("hub sign-in check", () => {
  it("lets the owner in with a valid Access session", async () => {
    const res = await run(req("/", await sign(key, claims()))).res;
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("Today - Mon Nov 9");
    expect(html).toContain("Sample invoice is ready to send");
  });

  for (const path of ["/", "/api/today", "/d/money", "/d/today", "/hub.css", "/hub.js", "/anything-else"]) {
    it(`refuses ${path} with no session and returns nothing private`, async () => {
      const res = await run(req(path)).res;
      expect(res.status).toBe(401);
      await expectNoPrivate(res);
    });
  }

  it("refuses direct API access with a JSON error and no data", async () => {
    const res = await run(req("/api/today")).res;
    expect(res.status).toBe(401);
    const body = (await res.json()) as Record<string, unknown>;
    expect(Object.keys(body).sort()).toEqual(["error", "message"]);
    expect(body.error).toBe("signed_out");
  });

  it("refuses a request with no Access token whatever the Host header says (does NOT prove deployed hostname isolation)", async () => {
    const res = await run(req("/api/today", undefined, { host: "penpost-hub.someone.workers.dev" })).res;
    expect(res.status).toBe(401);
    await expectNoPrivate(res);
  });

  it("refuses a token for a different Access application (audience)", async () => {
    const res = await run(req("/", await sign(key, claims({ aud: ["some-other-app"] })))).res;
    expect(res.status).toBe(401);
    await expectNoPrivate(res);
  });

  it("refuses a token from a different issuer", async () => {
    const res = await run(req("/", await sign(key, claims({ iss: "https://evil.cloudflareaccess.com" })))).res;
    expect(res.status).toBe(401);
  });

  it("refuses a token signed by an unknown key, after one refresh of the published keys", async () => {
    const { res, calls } = run(req("/", await sign(otherKey, claims())));
    expect((await res).status).toBe(401);
    expect(calls.length).toBe(2);
  });

  it("refuses a forged token (payload changed after signing)", async () => {
    const good = await sign(key, claims({ email: "intruder@example.com" }));
    const [h, , s] = good.split(".");
    const forgedPayload = btoa(JSON.stringify(claims())).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    const res = await run(req("/", `${h}.${forgedPayload}.${s}`)).res;
    expect(res.status).toBe(401);
  });

  it("refuses alg=none and garbage tokens", async () => {
    const none = `${btoa(JSON.stringify({ alg: "none", kid: "k1" }))}.${btoa(JSON.stringify(claims()))}.`;
    expect((await run(req("/", none)).res).status).toBe(401);
    expect((await run(req("/", "not-a-jwt")).res).status).toBe(401);
    expect((await run(req("/", "a".repeat(9000))).res).status).toBe(401);
  });

  it("tells an expired session to sign in again", async () => {
    const t = Math.floor(NOW.getTime() / 1000);
    const res = await run(req("/", await sign(key, claims({ exp: t - 3600 })))).res;
    expect(res.status).toBe(401);
    const html = await res.text();
    expect(html).toContain("Your sign-in has expired.");
    expect(html).not.toContain("Sample invoice is ready to send");
  });

  it("refuses a token that is not valid yet", async () => {
    const t = Math.floor(NOW.getTime() / 1000);
    expect((await run(req("/", await sign(key, claims({ nbf: t + 3600 })))).res).status).toBe(401);
  });

  it("denies another identity with a valid Access session", async () => {
    const res = await run(req("/", await sign(key, claims({ email: "someone.else@example.com" })))).res;
    expect(res.status).toBe(403);
    const html = await res.text();
    expect(html).toContain("This account cannot open this hub.");
    expect(html).not.toContain("Sample invoice is ready to send");
  });

  it("matches the allowed email without regard to case", async () => {
    expect((await run(req("/", await sign(key, claims({ email: OWNER.toUpperCase() })))).res).status).toBe(200);
  });

  it("says the sign-in check is down (not 'signed out') when Access keys cannot be fetched", async () => {
    const res = await run(req("/", await sign(key, claims())), env, () => [key], true).res;
    expect(res.status).toBe(503);
    const html = await res.text();
    expect(html).toContain("Sign-in check is down");
    expect(html).not.toContain("You are not signed in.");
    await expectNoPrivate(new Response(html));
  });

  it("stays locked when setup is incomplete", async () => {
    for (const missing of ["ACCESS_TEAM_DOMAIN", "ACCESS_AUD", "ALLOWED_EMAILS"] as const) {
      const res = await run(req("/", await sign(key, claims())), { ...env, [missing]: "" }).res;
      expect(res.status).toBe(503);
      expect(await res.text()).toContain("Hub not set up");
    }
  });

  it("only allows GET and HEAD", async () => {
    const res = await run(req("/api/today", await sign(key, claims()), { method: "POST" })).res;
    expect(res.status).toBe(405);
  });

  it("rejects very long URLs before doing anything", async () => {
    const { res, calls } = run(req(`/?q=${"x".repeat(3000)}`));
    expect((await res).status).toBe(414);
    expect(calls.length).toBe(0);
  });

  it("applies the rate limiter before the sign-in check", async () => {
    const limited = { ...env, RATE_LIMITER: { limit: async () => ({ success: false }) } };
    const { res, calls } = run(req("/", await sign(key, claims())), limited);
    expect((await res).status).toBe(429);
    expect(calls.length).toBe(0);
  });

  it("never logs tokens or emails", async () => {
    const spies = (["log", "info", "warn", "error", "debug"] as const).map((m) => vi.spyOn(console, m).mockImplementation(() => {}));
    const token = await sign(key, claims());
    await run(req("/", token)).res;
    await run(req("/", await sign(key, claims({ email: "someone.else@example.com" })))).res;
    await run(req("/", token), env, () => [key], true).res;
    const logged = spies.flatMap((s) => s.mock.calls.flat().map(String)).join("\n");
    expect(logged).not.toContain(token.slice(0, 20));
    expect(logged).not.toContain("@example.com");
    spies.forEach((s) => s.mockRestore());
  });
});

describe("public stylesheet for error pages", () => {
  it("is served without a session and contains nothing private", async () => {
    const { res, calls } = run(req("/hub-public.css"));
    const r = await res;
    expect(r.status).toBe(200);
    expect(r.headers.get("content-type")).toContain("text/css");
    expect(calls.length).toBe(0);
    await expectNoPrivate(r);
  });
  it("is the only public route; the main stylesheet still needs a session", async () => {
    expect((await run(req("/hub.css")).res).status).toBe(401);
    expect((await run(req("/hub-public.css/../hub.css")).res).status).toBe(401);
    expect((await run(req("/hub-public.css?x=/api/today")).res).status).toBe(200);
  });
});

describe("hub response headers and sign-out link (local checks; deployed cache isolation is unverified)", () => {
  it("marks every response private and no-store, and sets no cookies of its own", async () => {
    const good = await sign(key, claims());
    const t = Math.floor(NOW.getTime() / 1000);
    const cases = [
      req("/", good),
      req("/api/today", good),
      req("/hub.css", good),
      req("/hub.js", good),
      req("/nope", good),
      req("/"),
      req("/", await sign(key, claims({ exp: t - 3600 }))),
      req("/", await sign(key, claims({ email: "x@example.com" }))),
      req("/hub-public.css"),
      req("/d/money", good),
    ];
    for (const r of cases) {
      const res = await run(r).res;
      const cc = res.headers.get("cache-control") ?? "";
      expect(cc).toContain("no-store");
      expect(cc).toContain("private");
      expect(res.headers.get("vary")).toContain("Cf-Access-Jwt-Assertion");
      expect(res.headers.get("set-cookie")).toBeNull();
      expect(res.headers.get("content-security-policy")).toContain("default-src 'none'");
    }
  });

  it("offers a sign-out link to the Access logout endpoint", async () => {
    const html = await (await run(req("/", await sign(key, claims()))).res).text();
    expect(html).toContain('href="/cdn-cgi/access/logout"');
  });

  it("a request without the session token is refused (stands in for sign-out; real cookie logout is unverified until deployed)", async () => {
    const token = await sign(key, claims());
    expect((await run(req("/api/today", token)).res).status).toBe(200);
    expect((await run(req("/api/today")).res).status).toBe(401);
  });

  it("checks the audience it was configured with", async () => {
    const res = await run(req("/", await sign(key, claims({ aud: AUD })))).res; // string aud also accepted
    expect(res.status).toBe(200);
  });
});
