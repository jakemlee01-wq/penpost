import { readFileSync } from "node:fs";
import { join } from "node:path";
import { _clearCache, coveredByActiveRuns, curate, curateStatus, evaluate, validateCurate, type Run } from "../worker/src/curate";
import { AreasSchema } from "../src/lib/areas";
import { allTopicIds } from "../src/lib/topics";
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

// ---------------------------------------------------------------------------
// On-demand editions: POST /curate and GET /curate/status

const areas = AreasSchema.parse(JSON.parse(readFileSync(join(__dirname, "../content/areas.json"), "utf8")));
const ALL = allTopicIds(areas.regions);
const MONDAY = new Date("2026-10-19T15:00:00Z"); // 10 a.m. Central
const DAY = "2026-10-19";
const ghEnv = { GEMINI_API_KEY: "k", GITHUB_TOKEN: "gh-token" };

/** Fake GitHub API: a manifest, draft runs and deploy runs; records dispatches. */
function github(opts: { manifest?: object | null; draft?: Run[]; deploy?: Run[] } = {}) {
  const dispatched: { inputs: { topics: string; date: string } }[] = [];
  const impl = (async (url: string, init?: RequestInit) => {
    expect((init?.headers as Record<string, string>).authorization).toBe("Bearer gh-token");
    if (url.includes("/contents/content/topics/")) {
      return opts.manifest ? new Response(JSON.stringify(opts.manifest)) : new Response("{}", { status: 404 });
    }
    if (url.endsWith("/dispatches")) {
      dispatched.push(JSON.parse(String(init?.body)));
      return new Response(null, { status: 204 });
    }
    if (url.includes("/workflows/draft-edition.yml/runs")) return new Response(JSON.stringify({ workflow_runs: opts.draft ?? [] }));
    if (url.includes("/workflows/deploy.yml/runs")) return new Response(JSON.stringify({ workflow_runs: opts.deploy ?? [] }));
    return new Response("{}", { status: 404 });
  }) as unknown as typeof fetch;
  return { impl, dispatched };
}

describe("curate Worker", () => {
  it("validates the date, topic IDs and the 20-topic cap", () => {
    expect(validateCurate({ date: DAY, topics: ["mn-business", "mn-business"] }, areas, MONDAY)).toEqual({ date: DAY, topics: ["mn-business"] });
    expect(validateCurate({ date: "2026-10-18", topics: ["mn-business"] }, areas, MONDAY)).toHaveProperty("error");
    expect(validateCurate({ date: "2026-13-01", topics: ["mn-business"] }, areas, MONDAY)).toHaveProperty("error");
    expect(validateCurate({ date: DAY, topics: ["mn-astrology"] }, areas, MONDAY)).toHaveProperty("error");
    expect(validateCurate({ date: DAY, topics: ["MN-business; rm"] }, areas, MONDAY)).toHaveProperty("error");
    expect(validateCurate({ date: DAY, topics: [] }, areas, MONDAY)).toHaveProperty("error");
    expect(validateCurate({ date: DAY, topics: ALL.slice(0, 21) }, areas, MONDAY)).toHaveProperty("error");
    expect(validateCurate({ date: "2026-10-17", topics: ["mn-business"] }, areas, new Date("2026-10-17T15:00:00Z"))).toHaveProperty("error");
  });

  it("refuses other websites and bad requests over HTTP", async () => {
    const post = (body: unknown, o: { origin?: string } = {}) =>
      handle(req(body, { path: "/curate", origin: o.origin }), ghEnv, github().impl);
    expect((await post({ date: DAY, topics: ["mn-business"] }, { origin: "https://evil.example" })).status).toBe(403);
    expect((await post({ date: DAY, topics: ["not a topic"] })).status).toBe(400);
    expect((await post({ date: DAY, topics: ALL.slice(0, 21) })).status).toBe(400);
    const status = await handle(new Request("https://penpost-setup.test/curate/status?date=x&topics=mn-business", { headers: { origin } }), ghEnv, github().impl);
    expect(status.status).toBe(400);
    expect((await handle(req({}, { path: "/curate/status" }), ghEnv, github().impl)).status).toBe(405);
  });

  it("dispatches one run for just the topics nobody has started", async () => {
    _clearCache();
    const gh = github({ manifest: { date: DAY, topics: { "mn-business": { status: "ready", finishedAt: "2026-10-19T12:00:00Z", storiesWritten: 0 } } } });
    const r = await curate({ date: DAY, topics: ["mn-business", "local-twin-cities", "mn-feel-good"] }, ghEnv, areas, gh.impl, MONDAY);
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ status: "generating", pending: ["local-twin-cities", "mn-feel-good"], ready: 1, total: 3 });
    expect(gh.dispatched).toEqual([{ ref: "main", inputs: { date: DAY, topics: "local-twin-cities,mn-feel-good" } }]);
  });

  it("is free and instant when everything is ready and deployed", async () => {
    _clearCache();
    const gh = github({
      manifest: { date: DAY, topics: { "mn-business": { status: "ready", finishedAt: "2026-10-19T12:00:00Z", storiesWritten: 2 } } },
      deploy: [{ status: "completed", conclusion: "success", created_at: "2026-10-19T12:01:00Z" }],
    });
    const r = await curate({ date: DAY, topics: ["mn-business"] }, ghEnv, areas, gh.impl, MONDAY);
    expect(r.body).toMatchObject({ status: "ready", readyAt: "2026-10-19T12:00:00Z" });
    expect(gh.dispatched).toHaveLength(0);
  });

  it("doesn't dispatch again for topics a queued or running edition covers", async () => {
    _clearCache();
    const gh = github({
      manifest: { date: DAY, topics: { "mn-technology": { status: "pending", startedAt: "x" } } },
      draft: [{ status: "queued", conclusion: null, created_at: "2026-10-19T14:59:00Z", display_title: "Draft edition: mn-technology,us-economy" }],
    });
    const r = await curate({ date: DAY, topics: ["mn-technology", "us-economy"] }, ghEnv, areas, gh.impl, MONDAY);
    expect(r.body).toMatchObject({ status: "generating", pending: ["mn-technology", "us-economy"] });
    expect(gh.dispatched).toHaveLength(0);
  });

  it("needs its GitHub token", async () => {
    expect((await curate({ date: DAY, topics: ["mn-business"] }, {}, areas, github().impl, MONDAY)).status).toBe(503);
  });

  it("reports failed when a run ended without the topics becoming ready", async () => {
    _clearCache();
    const gh = github({
      manifest: { date: DAY, topics: { "mn-food": { status: "pending", startedAt: "x" } } },
      draft: [{ status: "completed", conclusion: "failure", created_at: "2026-10-19T14:00:00Z", display_title: "Draft edition: mn-food" }],
    });
    const r = await curateStatus(new URLSearchParams({ date: DAY, topics: "mn-food" }), ghEnv, areas, gh.impl, MONDAY);
    expect(r.body).toMatchObject({ status: "failed", failed: ["mn-food"] });
    expect(gh.dispatched).toHaveLength(0);
  });

  it("waits for the deploy after a topic is written", () => {
    const manifest = { date: DAY, topics: { "mn-food": { status: "ready" as const, finishedAt: "2026-10-19T12:00:00Z", storiesWritten: 3 } } };
    const old: Run = { status: "completed", conclusion: "success", created_at: "2026-10-19T11:00:00Z" };
    const running: Run = { status: "in_progress", conclusion: null, created_at: "2026-10-19T12:01:00Z" };
    const done: Run = { status: "completed", conclusion: "success", created_at: "2026-10-19T12:01:00Z" };
    const failed: Run = { status: "completed", conclusion: "failure", created_at: "2026-10-19T12:01:00Z" };
    expect(evaluate(["mn-food"], manifest, [], [running, old], ALL).pending).toEqual(["mn-food"]);
    expect(evaluate(["mn-food"], manifest, [], [done, old], ALL).ready).toEqual(["mn-food"]);
    expect(evaluate(["mn-food"], manifest, [], [failed, old], ALL).failed).toEqual(["mn-food"]);
    // A topic with no news is ready at once and doesn't ask the app for a newer build.
    const quiet = { date: DAY, topics: { "mn-food": { status: "ready" as const, finishedAt: "2026-10-19T12:00:00Z", storiesWritten: 0 } } };
    expect(evaluate(["mn-food"], quiet, [], [], ALL)).toMatchObject({ ready: ["mn-food"], readyAt: "" });
  });

  it("reads which topics a run covers from its title", () => {
    const runs: Run[] = [
      { status: "in_progress", conclusion: null, created_at: "", display_title: "Draft edition: mn-food,us-food" },
      { status: "completed", conclusion: "success", created_at: "", display_title: "Draft edition: all topics" },
    ];
    expect([...coveredByActiveRuns(runs, ALL)].sort()).toEqual(["mn-food", "us-food"]);
    expect(coveredByActiveRuns([{ status: "queued", conclusion: null, created_at: "", display_title: "Draft edition: all topics" }], ALL).size).toBe(30);
  });
});
