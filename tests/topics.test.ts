import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildTopics } from "../pipeline/agent";
import { AreasSchema } from "../src/lib/areas";
import { bundleHas, curateBase } from "../src/lib/curate";
import {
  allTopicIds,
  claimTopics,
  curatingLines,
  finishTopics,
  isRealDate,
  isWeekend,
  parseManifest,
  planTopics,
  readerTopicIds,
  serializeManifest,
  type TopicManifest,
} from "../src/lib/topics";

const areas = AreasSchema.parse(JSON.parse(readFileSync(join(__dirname, "../content/areas.json"), "utf8")));
const prefs = (p: { areas?: string[]; interests?: { category: string; scope: string }[] }) =>
  ({ areas: p.areas ?? [], interests: p.interests ?? [] }) as Parameters<typeof readerTopicIds>[0];

describe("topic IDs", () => {
  it("matches the drafting job's topic list exactly", () => {
    expect(allTopicIds(areas.regions)).toEqual(buildTopics(areas.regions).map((t) => t.id));
    expect(allTopicIds(areas.regions)).toHaveLength(30);
  });
});

describe("topics from a reader's settings", () => {
  it("rolls towns, counties and regions up to one local topic per region", () => {
    const ids = readerTopicIds(prefs({ areas: ["town:minneapolis", "county:ramsey", "region:northeast"], interests: [{ category: "business", scope: "local" }] }), areas);
    expect(ids).toEqual(["local-twin-cities", "local-northeast", "mn-feel-good"]);
  });

  it("maps Minnesota sections to mn- topics and national sections to us- plus mn- topics", () => {
    const ids = readerTopicIds(
      prefs({ interests: [{ category: "technology", scope: "minnesota" }, { category: "economy", scope: "national" }] }),
      areas,
    );
    expect(ids.sort()).toEqual(["mn-economy", "mn-feel-good", "mn-technology", "us-economy", "us-feel-good"].sort());
  });

  it("adds us-feel-good only with a national section", () => {
    expect(readerTopicIds(prefs({ interests: [{ category: "sports", scope: "minnesota" }] }), areas)).not.toContain("us-feel-good");
  });

  it("gives a reader with no sections the starter default", () => {
    expect(readerTopicIds(prefs({}), areas)).toEqual(["mn-business", "mn-feel-good"]);
  });

  it("only ever produces real topic IDs, at most 20", () => {
    const all = new Set(allTopicIds(areas.regions));
    const everything = prefs({
      areas: areas.regions.map((r) => `region:${r.id}`),
      interests: ["business", "economy", "agriculture", "technology", "sports", "politics", "health", "real-estate", "food", "culture"].map((c) => ({ category: c, scope: "national" })),
    });
    const ids = readerTopicIds(everything, areas);
    expect(ids.length).toBeLessThanOrEqual(20);
    expect(ids.every((id) => all.has(id))).toBe(true);
  });
});

describe("topic manifest", () => {
  const base: TopicManifest = {
    date: "2026-10-19",
    topics: {
      "local-twin-cities": { status: "ready", startedAt: "a", finishedAt: "b", storiesWritten: 3, modelCalls: 9 },
      "mn-technology": { status: "pending", startedAt: "c" },
    },
  };

  it("claims only topics that aren't ready, so a second tap never pays twice", () => {
    const { manifest, claimed } = claimTopics(base, ["local-twin-cities", "mn-business", "mn-business"], "now");
    expect(claimed).toEqual(["mn-business"]);
    expect(manifest.topics["mn-business"]).toEqual({ status: "pending", startedAt: "now" });
    expect(manifest.topics["local-twin-cities"].status).toBe("ready");
  });

  it("plans the asked topics plus leftovers still pending, minus anything ready", () => {
    expect(planTopics(base, ["local-twin-cities", "us-economy"]).sort()).toEqual(["mn-technology", "us-economy"]);
  });

  it("records results with spend, keeping topics the run didn't report on", () => {
    const m = finishTopics(base, { "mn-technology": { status: "ready", storiesWritten: 2, modelCalls: 11 }, "us-sports": { status: "failed", storiesWritten: 0, modelCalls: 1, error: "429" } }, "end");
    expect(m.topics["mn-technology"]).toEqual({ status: "ready", startedAt: "c", finishedAt: "end", storiesWritten: 2, modelCalls: 11 });
    expect(m.topics["us-sports"].status).toBe("failed");
    expect(m.topics["local-twin-cities"]).toEqual(base.topics["local-twin-cities"]);
  });

  it("round-trips through JSON and drops malformed entries", () => {
    const text = serializeManifest(base);
    expect(parseManifest(text, base.date)).toEqual(base);
    const bad = parseManifest(JSON.stringify({ topics: { "../etc": { status: "ready" }, "mn-food": { status: "weird" }, "mn-sports": { status: "ready" } } }), "2026-10-19");
    expect(Object.keys(bad.topics)).toEqual(["mn-sports"]);
    expect(parseManifest("not json", "2026-10-19").topics).toEqual({});
  });
});

describe("dates and curating copy", () => {
  it("accepts only real calendar dates and knows weekends", () => {
    expect(isRealDate("2026-10-19")).toBe(true);
    expect(isRealDate("2026-02-30")).toBe(false);
    expect(isRealDate("2026-10-19T00:00")).toBe(false);
    expect(isWeekend("2026-10-17")).toBe(true);
    expect(isWeekend("2026-10-19")).toBe(false);
  });

  it("builds one line per topic from the reader's own topics", () => {
    const lines = curatingLines(["local-twin-cities", "mn-technology", "us-economy", "mn-feel-good"], areas.regions);
    expect(lines).toEqual([
      "Checking what's happening in the Twin Cities.",
      "Reading up on Minnesota startups and tech.",
      "Scanning national news on the economy.",
      "Looking for some good news close to home.",
      "Checking every story against its sources.",
    ]);
  });
});

describe("curate client", () => {
  it("finds the Worker from the setup parser's URL", () => {
    expect(curateBase("https://penpost-setup.x.workers.dev/parse", "")).toBe("https://penpost-setup.x.workers.dev");
    expect(curateBase("", "https://w.example/curate")).toBe("https://w.example");
    expect(curateBase("", "")).toBe("");
  });

  it("knows whether this bundle has stories that finished at a given time", () => {
    expect(bundleHas("2026-10-19T12:10:00Z", "2026-10-19T12:12:00Z")).toBe(true);
    expect(bundleHas("2026-10-19T12:10:00Z", "2026-10-19T09:00:00Z")).toBe(false);
    expect(bundleHas("2026-10-19T12:10:00Z", "")).toBe(false);
  });
});
