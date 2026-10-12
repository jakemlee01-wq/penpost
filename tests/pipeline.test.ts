import { cpSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { parseFeed } from "../pipeline/feeds";
import { createModel, type Call } from "../pipeline/model";
import { pickWriter, runPipeline, slugify, tidy } from "../pipeline/run";
import { parseStoryFile } from "../src/lib/parse";
import { WriterSchema } from "../src/lib/schema";

const repo = join(__dirname, "..");
let tmp = "";

function makeRoot() {
  tmp = mkdtempSync(join(tmpdir(), "penpost-"));
  cpSync(join(repo, "content"), join(tmp, "content"), { recursive: true });
  rmSync(join(tmp, "content", "stories"), { recursive: true });
  rmSync(join(tmp, "content", "editions"), { recursive: true });
  mkdirSync(join(tmp, "content", "stories"));
  mkdirSync(join(tmp, "content", "editions"));
  mkdirSync(join(tmp, "pipeline"));
  const sources = { sources: [{ id: "mpr-business", name: "Fixture Outlet", url: "https://example.org/feed", enabled: true, fullTextAllowed: false, kind: "news" }] };
  writeFileSync(join(tmp, "pipeline", "sources.json"), JSON.stringify(sources));
  return tmp;
}
afterEach(() => tmp && rmSync(tmp, { recursive: true, force: true }));

const BODY = "A fictional manufacturer in Willmar says it will add 40 jobs — mostly production roles. ".repeat(4);

function responder(opts: { unsupported?: string[] } = {}) {
  return (call: Call): string => {
    if (call.system.includes("You sort news items")) {
      return JSON.stringify({
        items: [
          { i: 0, keep: true, reason: "", cities: ["willmar"], significance: "regional", significanceReason: "Jobs in west central MN", categories: ["business", "astrology"], tone: "light", mustKnow: false, topics: ["jobs"], storyKey: "willmar-jobs" },
          { i: 1, keep: false, reason: "sports", cities: [], significance: "local", significanceReason: "", topics: [], storyKey: "sports" },
          { i: 2, keep: true, reason: "", cities: ["atlantis"], significance: "local", significanceReason: "", topics: ["small-business"], storyKey: "bakery" },
        ],
      });
    }
    if (call.system.includes("fact record for a news story")) {
      return JSON.stringify({ enough: true, what: "jobs", facts: [1, 2, 3].map((n) => ({ text: `fact ${n}`, type: "claim", attribution: "company" })), unknowns: [] });
    }
    if (call.system.includes("fact-check")) return JSON.stringify({ unsupported: opts.unsupported ?? [], styleIssues: [] });
    return "```json\n" + JSON.stringify({ headline: "Willmar plant plans 40 new jobs", preview: "A manufacturer says it will hire. Details are still thin.", bodyMarkdown: BODY, scene: "factory", imageAlt: "A sunny factory" }) + "\n```";
  };
}

describe("pipeline", () => {
  it("parses RSS, keeps only fresh unseen items, and ignores injected instructions as data", () => {
    const items = parseFeed(readFileSync(join(__dirname, "fixtures/feeds/mpr-business.xml"), "utf8"), { id: "x", name: "X", url: "", enabled: true, fullTextAllowed: false, kind: "news" });
    expect(items).toHaveLength(4);
    expect(items[0].summary).not.toContain("<p>");
    expect(items[0].fullText).toBeUndefined();
  });

  it("drafts, validates, and writes an edition with a mock model", async () => {
    const root = makeRoot();
    const model = createModel({ PENPOST_PROVIDER: "mock" }, responder());
    const res = await runPipeline({ root, date: "2026-10-09", now: new Date("2026-10-09T11:00:00Z"), feedsDir: join(__dirname, "fixtures/feeds"), model, log: () => {} });
    expect(res.written).toHaveLength(1);
    const file = readdirSync(join(root, "content/stories"))[0];
    const story = parseStoryFile(readFileSync(join(root, "content/stories", file), "utf8"), file);
    expect(story.status).toBe("published");
    expect(story.cities).toEqual(["willmar"]);
    expect(story.bodyMarkdown).not.toContain("—");
    expect(story.isDemo).toBe(false);
    expect(story.categories).toEqual(["business"]); // unknown category from the model is coerced, not trusted
    expect(story.tone).toBe("light");
    const edition = JSON.parse(readFileSync(join(root, "content/editions/2026-10-09.json"), "utf8"));
    expect(edition.candidateStoryIds).toEqual([story.id]);
    expect(res.skipped.join("\n")).toMatch(/sports/);
    expect(res.skipped.join("\n")).toMatch(/no known town/);
    expect(model.usage.calls).toBe(4); // 1 triage + facts, draft, check
  });

  it("holds a story as draft when the checker finds unsupported statements", async () => {
    const root = makeRoot();
    const model = createModel({ PENPOST_PROVIDER: "mock" }, responder({ unsupported: ["40 jobs"] }));
    const res = await runPipeline({ root, date: "2026-10-09", now: new Date("2026-10-09T11:00:00Z"), feedsDir: join(__dirname, "fixtures/feeds"), model, log: () => {} });
    expect(res.written[0].status).toBe("draft");
    expect(readdirSync(join(root, "content/editions"))).toHaveLength(0);
    expect(readFileSync(res.summaryPath, "utf8")).toMatch(/Held for edits/);
  });

  it("stops at the call budget", async () => {
    const root = makeRoot();
    const model = createModel({ PENPOST_PROVIDER: "mock", PENPOST_MAX_CALLS: "2" }, responder());
    const res = await runPipeline({ root, date: "2026-10-09", now: new Date("2026-10-09T11:00:00Z"), feedsDir: join(__dirname, "fixtures/feeds"), model, log: () => {} });
    expect(res.written).toHaveLength(0);
    expect(res.skipped.join("\n")).toMatch(/Budget stop/);
  });

  it("rotates writers and never repeats back to back", () => {
    const writers = WriterSchema.array().parse(JSON.parse(readFileSync(join(repo, "content/writers/writers.json"), "utf8")));
    const a = pickWriter(writers, ["emma", "emma", "jack"]);
    expect(["grace", "luke", "ben"]).toContain(a.id);
    expect(pickWriter(writers, [], "ben").id).not.toBe("ben");
  });

  it("tidies text the validator would reject", () => {
    expect(tidy("One — two")).toBe("One, two");
    expect(tidy("Why it matters: stuff")).toBe("stuff");
    expect(slugify("Land O'Lakes bets on milk")).toBe("land-olakes-bets-on-milk");
  });
});

describe("stock photos", () => {
  it("picks the first free Unsplash result, credits it, and pings the download endpoint", async () => {
    const { findStockPhoto } = await import("../pipeline/photos");
    const calls: string[] = [];
    const fake = (async (url: string) => {
      calls.push(url);
      if (url.includes("/search/photos")) {
        return new Response(
          JSON.stringify({
            results: [
              { plus: true, urls: { regular: "https://images.example/plus" }, links: { html: "https://unsplash.com/p/1", download_location: "https://api.unsplash.com/d/1" }, user: { name: "Paid" } },
              { alt_description: "a grain elevator at sunset", urls: { regular: "https://images.example/free" }, links: { html: "https://unsplash.com/p/2", download_location: "https://api.unsplash.com/d/2" }, user: { name: "Free Person" } },
            ],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      return new Response("{}", { status: 200 });
    }) as unknown as typeof fetch;
    const found = await findStockPhoto("grain elevator", "KEY", fake);
    expect(found?.photo.kind).toBe("stock");
    expect(found?.photo.caption).toMatch(/^Stock photo:/);
    expect(found?.photo.credit).toBe("Free Person / Unsplash");
    expect(found?.photo.hotlinkUrl).toBe("https://images.example/free");
    expect(calls.some((c) => c.startsWith("https://api.unsplash.com/d/2"))).toBe(true);
  });
  it("does nothing without a key", async () => {
    const { findStockPhoto } = await import("../pipeline/photos");
    expect(await findStockPhoto("anything", undefined)).toBeNull();
  });
});

describe("createModel env handling", () => {
  it("falls back to default Gemini models when repo variables are empty strings (as in GitHub Actions)", async () => {
    const urls: string[] = [];
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async (url: string) => {
      urls.push(String(url));
      return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: "ok" }] } }] }), { status: 200 });
    }) as unknown as typeof fetch;
    try {
      const model = createModel({ PENPOST_PROVIDER: "gemini", GEMINI_API_KEY: "k", PENPOST_TRIAGE_MODEL: "", PENPOST_WRITER_MODEL: "" });
      await model.complete({ tier: "triage", system: "s", prompt: "p" });
      await model.complete({ tier: "writer", system: "s", prompt: "p" });
    } finally {
      globalThis.fetch = realFetch;
    }
    expect(urls[0]).toContain("/models/gemini-3.5-flash-lite:generateContent");
    expect(urls[1]).toContain("/models/gemini-3.8-flash:generateContent");
  });
});

describe("Gemini rate limits", () => {
  it("switches the writer to the fallback model when its daily quota is used up, and stays there", async () => {
    const urls: string[] = [];
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async (url: string) => {
      urls.push(String(url));
      if (String(url).includes("gemini-3.8-flash:")) {
        return new Response(JSON.stringify({ error: { code: 429, details: [{ violations: [{ quotaId: "GenerateRequestsPerDayPerProjectPerModel-FreeTier" }] }] } }), { status: 429 });
      }
      return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: "ok" }] } }] }), { status: 200 });
    }) as unknown as typeof fetch;
    try {
      const model = createModel({ PENPOST_PROVIDER: "gemini", GEMINI_API_KEY: "k" });
      expect(await model.complete({ tier: "writer", system: "s", prompt: "p" })).toBe("ok");
      expect(await model.complete({ tier: "writer", system: "s", prompt: "p" })).toBe("ok");
    } finally {
      globalThis.fetch = realFetch;
    }
    expect(urls.map((u) => u.match(/models\/([^:]+)/)![1])).toEqual(["gemini-3.8-flash", "gemini-3.5-flash-lite", "gemini-3.5-flash-lite"]);
  });

  it("does not hide other client errors behind a fallback", async () => {
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async () => new Response("bad key", { status: 403 })) as unknown as typeof fetch;
    try {
      const model = createModel({ PENPOST_PROVIDER: "gemini", GEMINI_API_KEY: "k" });
      await expect(model.complete({ tier: "writer", system: "s", prompt: "p" })).rejects.toThrow("HTTP 403");
    } finally {
      globalThis.fetch = realFetch;
    }
  });
});
