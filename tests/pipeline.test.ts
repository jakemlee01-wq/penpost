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
          { i: 0, keep: true, reason: "", cities: ["willmar"], significance: "regional", significanceReason: "Jobs in west central MN", topics: ["jobs"], storyKey: "willmar-jobs" },
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
