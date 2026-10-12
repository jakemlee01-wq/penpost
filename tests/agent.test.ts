import { cpSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildTopics, matchSources, pickEvents, runAgent, sameEvent, type Event } from "../pipeline/agent";
import { createModel, type Call } from "../pipeline/model";
import { parseStoryFile } from "../src/lib/parse";

const repo = join(__dirname, "..");
let tmp = "";
afterEach(() => tmp && rmSync(tmp, { recursive: true, force: true }));

function makeRoot() {
  tmp = mkdtempSync(join(tmpdir(), "penpost-agent-"));
  cpSync(join(repo, "content"), join(tmp, "content"), { recursive: true });
  return tmp;
}

const facts = [
  { text: "Acme Foods said Monday it will add 120 jobs at its Willmar plant.", type: "confirmed", attribution: "Acme Foods" },
  { text: "The expansion costs $18 million.", type: "confirmed", attribution: "Acme Foods" },
  { text: "Construction starts in March 2027.", type: "confirmed", attribution: "West Central Tribune" },
  { text: "The plant currently employs 340 people.", type: "confirmed", attribution: "West Central Tribune" },
  { text: "The city approved a tax abatement last month.", type: "confirmed", attribution: "City of Willmar" },
];

/** Fake Gemini search endpoint: one event per topic, keyed by the topic text. */
function eventFor(topic: string) {
  return {
    headline: `Story about ${topic}`,
    what: `Something happened in ${topic}`,
    storyKey: topic.slice(0, 40),
    cities: ["willmar", "not-a-town"],
    significance: "local",
    categories: ["business"],
    tone: "light",
    mustKnow: false,
    topics: ["jobs", "expansions"],
    newsworthiness: 4,
    facts,
    sourceNames: ["West Central Tribune"],
  };
}

/** Fake Gemini search endpoint: plain notes naming the topic, with grounding sources unless `grounded` is false. */
function fakeSearch(grounded = true, calls: string[] = []): typeof fetch {
  return (async (_url: string, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body ?? "{}"));
    const prompt: string = body.contents[0].parts[0].text;
    calls.push(prompt);
    const topic: string = prompt.match(/this topic: ([^.]+)\./)?.[1] ?? "x";
    const chunks = grounded ? [{ web: { uri: "https://www.wctrib.com/news/acme", title: "wctrib.com" } }, { web: { uri: "https://example-blog.net/x", title: "example-blog.net" } }] : [];
    return new Response(
      JSON.stringify({ candidates: [{ content: { parts: [{ text: `NOTES topic=${topic}` }] }, groundingMetadata: { groundingChunks: chunks } }] }),
      { status: 200 },
    );
  }) as unknown as typeof fetch;
}

function writerResponder(unsupported: string[] = []) {
  return (call: Call) =>
    call.system.startsWith("You turn a news researcher")
      ? JSON.stringify({ items: [eventFor(call.prompt.match(/topic=([^\n]+)/)?.[1] ?? "x")] })
      : call.system.startsWith("You fact-check")
      ? JSON.stringify({ unsupported, styleIssues: [] })
      : JSON.stringify({
          headline: "Acme adds 120 jobs in Willmar",
          preview: "The food maker plans an $18 million expansion of its Willmar plant.",
          bodyMarkdown: "Acme Foods said Monday it will add 120 jobs at its Willmar plant, an $18 million expansion. ".repeat(4),
          scene: "factory",
          imageAlt: "A sunny food plant on the prairie",
          photoQuery: "food factory",
        });
}

describe("agent topics and picking", () => {
  it("covers every region plus Minnesota and national topics for every category", () => {
    const topics = buildTopics([{ id: "a", name: "A" }, { id: "b", name: "B" }]);
    expect(topics.filter((t) => t.scope === "local")).toHaveLength(2);
    expect(topics.filter((t) => t.scope === "minnesota")).toHaveLength(10);
    expect(topics.filter((t) => t.scope === "national")).toHaveLength(10);
  });

  it("takes one event per topic before any topic gets a second, and drops duplicates", () => {
    const ev = (k: string, n: number) => ({ storyKey: k, headline: k, newsworthiness: n }) as unknown as Event;
    const picked = pickEvents([[ev("a1", 5), ev("a2", 4)], [ev("b1", 3)], [ev("a1", 5), ev("c1", 2)]], 10);
    expect(picked.map((e) => e.storyKey)).toEqual(["a1", "b1", "c1", "a2"]);
  });

  it("treats differently worded headlines about one event as the same event", () => {
    const e = (headline: string) => ({ headline, storyKey: "" });
    expect(sameEvent(e("Federal agents search Rep. Ilhan Omar's D.C. home"), e("Federal agents search Rep. Ilhan Omar's residence"))).toBe(true);
    expect(sameEvent(e("Gun fires during Mankato arrest with no injuries reported"), e("Suspect arrested in Mankato after handgun fires during struggle"))).toBe(true);
    expect(sameEvent(e("Vikings beat Saints to stay unbeaten"), e("Wild top Panthers behind Kaprizov hat trick"))).toBe(false);
    expect(sameEvent(e("Rochester approves downtown housing plan"), e("Duluth approves downtown parking plan"))).toBe(false);
  });

  it("skips heavy stories unless they are must-know", () => {
    const ev = (k: string, tone: string, mustKnow = false) => ({ storyKey: k, headline: k, newsworthiness: 3, tone, mustKnow }) as unknown as Event;
    const picked = pickEvents([[ev("crash", "heavy"), ev("closing", "heavy", true), ev("opening", "light")]], 10);
    expect(picked.map((e) => e.storyKey).sort()).toEqual(["closing", "opening"]);
  });

  it("matches grounding sources to the outlets an event cites", () => {
    const s = [{ title: "wctrib.com", url: "https://www.wctrib.com/a" }, { title: "kare11.com", url: "https://kare11.com/b" }];
    expect(matchSources(s, ["West Central Tribune (wctrib)"]).map((x) => x.title)).toEqual(["wctrib.com"]);
    expect(matchSources(s, ["Unknown Outlet"])).toHaveLength(2);
  });
});

describe("runAgent end to end (fake Gemini)", () => {
  it("writes published stories with sources and a manifest, keeping only catalog towns", async () => {
    const root = makeRoot();
    const before = new Set(readdirSync(join(root, "content/stories")));
    const model = createModel({ PENPOST_PROVIDER: "mock", PENPOST_MAX_CALLS: "200" }, writerResponder());
    const res = await runAgent({ root, date: "2026-10-13", maxStories: 5, model, key: "k", fetchImpl: fakeSearch(), log: () => {} });
    expect(res.published).toBe(5);
    const files = readdirSync(join(root, "content/stories")).filter((f) => !before.has(f));
    expect(files).toHaveLength(5);
    const s = parseStoryFile(readFileSync(join(root, "content/stories", files[0]), "utf8"), files[0]);
    expect(s.status).toBe("published");
    expect(s.cities).toEqual(["willmar"]);
    expect(s.sources[0].url).toBe("https://www.wctrib.com/news/acme");
    const manifest = JSON.parse(readFileSync(join(root, "content/editions/2026-10-13.json"), "utf8"));
    expect(manifest.candidateStoryIds).toHaveLength(5);
  });

  it("holds stories the checker flags and leaves them out of the edition", async () => {
    const root = makeRoot();
    const model = createModel({ PENPOST_PROVIDER: "mock", PENPOST_MAX_CALLS: "200" }, writerResponder(["$18 million"]));
    const res = await runAgent({ root, date: "2026-10-13", maxStories: 2, model, key: "k", fetchImpl: fakeSearch(), log: () => {} });
    expect(res.published).toBe(0);
    expect(res.written.every((w) => w.status === "draft")).toBe(true);
  });

  it("retries once when Gemini answers without searching, then drops the topic", async () => {
    const root = makeRoot();
    const calls: string[] = [];
    const model = createModel({ PENPOST_PROVIDER: "mock", PENPOST_MAX_CALLS: "200" }, writerResponder());
    process.env.PENPOST_TOPICS = "local-twin-cities";
    try {
      const res = await runAgent({ root, date: "2026-10-13", maxStories: 5, model, key: "k", fetchImpl: fakeSearch(false, calls), log: () => {} });
      expect(res.published).toBe(0);
    } finally {
      delete process.env.PENPOST_TOPICS;
    }
    expect(calls).toHaveLength(2);
    expect(calls[1]).toContain("at least two Google searches");
  });
});
