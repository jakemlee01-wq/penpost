import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { AreasSchema, expandAreas, townsWithRegion } from "../src/lib/areas";
import { parseStoryFile } from "../src/lib/parse";
import { assembleStoryIds, eligibility, scoreStories, type ReaderProfile } from "../src/lib/ranking";
import type { Story } from "../src/lib/schema";

const areas = AreasSchema.parse(JSON.parse(readFileSync(join(__dirname, "..", "content", "areas.json"), "utf8")));
const towns = townsWithRegion(areas);
const dir = join(__dirname, "..", "content", "stories");
const pool: Story[] = readdirSync(dir).filter((f) => f.endsWith(".md")).map((f) => parseStoryFile(readFileSync(join(dir, f), "utf8"), f));
const byId = (id: string) => pool.find((s) => s.id === id)!;
const base = (over: Partial<ReaderProfile> = {}): ReaderProfile => ({
  towns: expandAreas(["region:twin-cities", "town:dawson"], areas),
  interests: [{ category: "business", scope: "minnesota" }],
  likes: [],
  avoids: [],
  favoriteWriters: [],
  ...over,
});

describe("interests and scope", () => {
  it("Twin Cities business at Minnesota scope: local business first, sports and national economy only as fill after it", () => {
    const ids = assembleStoryIds(pool, base(), towns, [], 20);
    expect(ids).toContain("2026-10-09-gudea");
    expect(ids.indexOf("2026-10-09-gudea")).toBeLessThan(ids.indexOf("2026-10-09-vikings-4-0"));
    const p = base();
    expect(eligibility(byId("2026-10-09-vikings-4-0"), p.towns, towns, p).eligible).toBe(false);
    expect(eligibility(byId("2026-10-09-september-jobs"), p.towns, towns, p).eligible).toBe(false);
  });
  it("Minnesota sports brings in the Vikings and Wild ahead of everything else", () => {
    const ids = assembleStoryIds(pool, base({ interests: [{ category: "sports", scope: "minnesota" }] }), towns, [], 20);
    expect(ids.slice(0, 2).sort()).toEqual(["2026-10-09-vikings-4-0", "2026-10-09-wild-tampa"]);
  });
  it("a reader whose interests match nothing still gets a full edition from their places", () => {
    const ids = assembleStoryIds(pool, base({ interests: [{ category: "culture", scope: "local" }] }), towns, [], 5);
    expect(ids.length).toBe(Math.min(5, pool.filter((s) => s.status !== "draft").length));
  });
  it("economy at Minnesota scope excludes the national jobs report; national scope includes it", () => {
    const mn = base({ interests: [{ category: "economy", scope: "minnesota" }] });
    const us = base({ interests: [{ category: "economy", scope: "national" }] });
    expect(eligibility(byId("2026-10-09-september-jobs"), mn.towns, towns, mn).eligible).toBe(false);
    expect(eligibility(byId("2026-10-09-september-jobs"), us.towns, towns, us).eligible).toBe(true);
  });
  it("'My places' scope keeps statewide stories out", () => {
    const p = base({ interests: [{ category: "business", scope: "local" }] });
    expect(eligibility(byId("2026-10-09-bair-hugger"), p.towns, towns, p).eligible).toBe(false);
    expect(eligibility(byId("2026-10-09-gudea"), p.towns, towns, p).eligible).toBe(true);
  });
  it("local stories still need a place match even with national scope", () => {
    const p = base({ towns: ["dawson"], interests: [{ category: "business", scope: "national" }] });
    expect(eligibility(byId("2026-10-09-gudea"), p.towns, towns, p).eligible).toBe(false);
  });
});

describe("lighter by default", () => {
  it("drops heavy stories for everyone unless they're must-know", () => {
    const p = base();
    expect(eligibility(byId("2026-10-09-hmongtown"), p.towns, towns, p).eligible).toBe(false);
    expect(eligibility({ ...byId("2026-10-09-hmongtown"), mustKnow: true }, p.towns, towns, p).eligible).toBe(true);
  });
  it("must-know stories get through any interest setting", () => {
    const s = { ...byId("2026-10-09-hmongtown"), mustKnow: true };
    const p = base({ interests: [{ category: "sports", scope: "national" }] });
    expect(eligibility(s, p.towns, towns, p).eligible).toBe(true);
  });
  it("never lets likes, dislikes or favorites move a story across geography tiers", () => {
    const p = base({
      favoriteWriters: ["emma"],
      likes: ["manufacturing", "health care", "agriculture"],
      avoids: ["small business", "startups"],
      interests: [{ category: "business", scope: "national" }, { category: "health", scope: "national" }],
    });
    const scored = scoreStories(pool, p, towns, { topics: {}, writers: {} });
    const local = scored.filter((x) => x.base === 100);
    const state = scored.filter((x) => x.base === 70);
    expect(local.length).toBeGreaterThan(0);
    expect(Math.min(...local.map((x) => x.score))).toBeGreaterThan(Math.max(...state.map((x) => x.score)));
  });
});

describe("favorite writers", () => {
  it("nudges a favorite up within its tier", () => {
    const plain = scoreStories(pool, base(), towns, { topics: {}, writers: {} });
    const fav = scoreStories(pool, base({ favoriteWriters: ["jack"] }), towns, { topics: {}, writers: {} });
    const s = (arr: typeof plain) => arr.find((x) => x.story.id === "2026-10-09-latino-business-week")!.score;
    expect(s(fav)).toBeGreaterThan(s(plain));
  });
});

describe("coverage", () => {
  it("gives each chosen section a slot when it has a story", () => {
    const p = base({ interests: [{ category: "business", scope: "minnesota" }, { category: "sports", scope: "minnesota" }, { category: "economy", scope: "national" }] });
    const ids = assembleStoryIds(pool, p, towns, []);
    expect(ids).toHaveLength(5);
    const cats = ids.map((id) => byId(id).categories);
    expect(cats.some((c) => c.includes("sports"))).toBe(true);
    expect(cats.some((c) => c.includes("economy"))).toBe(true);
    expect(cats.some((c) => c.includes("business"))).toBe(true);
  });
  it("still leads with local stories", () => {
    const p = base({ interests: [{ category: "business", scope: "minnesota" }, { category: "sports", scope: "minnesota" }] });
    const ids = assembleStoryIds(pool, p, towns, []);
    expect(byId(ids[0]).significance).toBe("local");
  });
});
