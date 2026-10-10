import { describe, expect, it } from "vitest";
import { handle, type Env } from "../worker/src/index";

const env: Env = { GEMINI_API_KEY: "test-key" };
const origin = "https://penpost.co";
const req = (body: unknown, init: { origin?: string; method?: string; path?: string } = {}) =>
  new Request(`https://penpost-setup.test${init.path ?? "/parse"}`, {
    method: init.method ?? "POST",
    headers: { origin: init.origin ?? origin, "content-type": "application/json" },
    body: init.method === "OPTIONS" ? undefined : JSON.stringify(body),
  });
const gemini = (reply: unknown, status = 200) =>
  (async (_url: string, init: RequestInit) => {
    const sent = JSON.parse(String(init.body));
    expect(sent.contents[0].parts[0].text).toContain("<reader>");
    return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(reply) }] } }] }), { status });
  }) as unknown as typeof fetch;

describe("setup Worker", () => {
  it("returns only catalog places, real sections and clean phrases", async () => {
    const res = await handle(
      req({ text: "Twin Cities, startups, no soccer" }),
      env,
      gemini({ areas: ["region:twin-cities", "region:mars"], interests: [{ category: "business", scope: "minnesota" }, { category: "gossip", scope: "national" }], likes: ["Startups"], avoids: ["soccer"] }),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("access-control-allow-origin")).toBe(origin);
    expect(await res.json()).toEqual({ areas: ["region:twin-cities"], interests: [{ category: "business", scope: "minnesota" }], likes: ["startups"], avoids: ["soccer"] });
  });
  it("refuses other websites", async () => {
    expect((await handle(req({ text: "hi" }, { origin: "https://evil.example" }), env, gemini({}))).status).toBe(403);
  });
  it("answers the browser's preflight", async () => {
    const res = await handle(req(null, { method: "OPTIONS" }), env, gemini({}));
    expect(res.status).toBe(204);
  });
  it("rejects empty and oversized answers", async () => {
    expect((await handle(req({ text: "" }), env, gemini({}))).status).toBe(400);
    expect((await handle(req({ text: "x".repeat(5000) }), env, gemini({}))).status).toBe(413);
  });
  it("reports a model failure so the site can fall back", async () => {
    expect((await handle(req({ text: "startups" }), env, gemini({}, 500))).status).toBe(502);
  });
  it("tries the next model when one isn't found", async () => {
    const tried: string[] = [];
    const flaky = (async (url: string) => {
      tried.push(url);
      if (tried.length === 1) return new Response(JSON.stringify({ error: { message: "model not found" } }), { status: 404 });
      return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: '{"interests":[{"category":"sports","scope":"minnesota"}]}' }] } }] }));
    }) as unknown as typeof fetch;
    const res = await handle(req({ text: "sports" }), { ...env, GEMINI_MODEL: "old-model" }, flaky);
    expect(res.status).toBe(200);
    expect(tried[0]).toContain("old-model");
    expect(tried[1]).toContain("gemini-3.5-flash-lite");
  });
  it("needs its key", async () => {
    expect((await handle(req({ text: "startups" }), { GEMINI_API_KEY: "" }, gemini({}))).status).toBe(503);
  });
});
