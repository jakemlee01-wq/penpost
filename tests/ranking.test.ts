import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { AreasSchema, townsWithRegion } from "../src/lib/areas";
import { parseStoryFile } from "../src/lib/parse";
import {
  BASE_SCORE,
  MAX_TASTE_ADJUSTMENT,
  assembleStoryIds,
  eligibility,
  tasteAdjustment,
  tasteFromFeedback,
} from "../src/lib/ranking";
import type { Feedback, Story, Town } from "../src/lib/schema";

const root = join(__dirname, "..", "content");
const towns: Town[] = townsWithRegion(AreasSchema.parse(JSON.parse(readFileSync(join(root, "areas.json"), "utf8"))));
// Ranking rules are tested against fixed fictional fixtures so tests don't change with the news.
const fixtures = join(__dirname, "fixtures", "stories");
const pool: Story[] = readdirSync(fixtures)
  .filter((f) => f.endsWith(".md"))
  .map((f) => parseStoryFile(readFileSync(join(fixtures, f), "utf8"), f));
const byId = (id: string) => pool.find((s) => s.id === id)!;
const JAKE = ["minneapolis", "dawson"];

describe("geography", () => {
  it("includes a local Minneapolis story", () => {
    expect(eligibility(byId("2026-10-09-lantern-coffee"), JAKE, towns).eligible).toBe(true);
  });
  it("includes a local Dawson story", () => {
    expect(eligibility(byId("2026-10-09-dawson-hardware"), JAKE, towns).eligible).toBe(true);
  });
  it("includes a major statewide story from another city", () => {
    const e = eligibility(byId("2026-10-09-rochester-meridian"), JAKE, towns);
    expect(e.eligible).toBe(true);
    expect(e.base).toBe(BASE_SCORE.statewide);
  });
  it("excludes a minor story from another city", () => {
    expect(eligibility(byId("2026-10-09-rochester-bakery"), JAKE, towns).eligible).toBe(false);
    expect(eligibility(byId("2026-10-09-st-cloud-salon"), JAKE, towns).eligible).toBe(false);
  });
  it("includes a regional story only for readers in that region", () => {
    const s = byId("2026-10-09-montevideo-trucking");
    expect(eligibility(s, JAKE, towns).eligible).toBe(true);
    expect(eligibility(s, ["minneapolis"], towns).eligible).toBe(false);
  });
  it("never fabricates coverage for a town with no news", () => {
    const ids = assembleStoryIds(pool, ["bemidji"], towns, []);
    const stories = ids.map(byId);
    expect(stories.every((s) => s.significance === "statewide" || s.cities.includes("bemidji"))).toBe(true);
    expect(ids.length).toBe(pool.filter((s) => s.significance === "statewide").length);
  });
});

describe("edition assembly", () => {
  it("builds Jake's default edition with eight stories and no excluded items", () => {
    const ids = assembleStoryIds(pool, JAKE, towns, []);
    expect(ids).toHaveLength(8);
    expect(ids).not.toContain("2026-10-09-rochester-bakery");
    expect(ids).not.toContain("2026-10-09-st-cloud-salon");
  });
  it("is deterministic", () => {
    expect(assembleStoryIds(pool, JAKE, towns, [])).toEqual(assembleStoryIds(pool, JAKE, towns, []));
  });
  it("avoids the same writer twice in a row when it can", () => {
    const ids = assembleStoryIds(pool, JAKE, towns, []);
    const writers = ids.map((id) => byId(id).writerId);
    for (let i = 1; i < writers.length; i++) expect(writers[i]).not.toBe(writers[i - 1]);
  });
  it("is shorter on a quiet day instead of padding", () => {
    expect(assembleStoryIds(pool, ["moorhead"], towns, []).length).toBeLessThan(8);
  });
});

describe("taste", () => {
  const fb = (storyId: string, vote: "up" | "down" | null): Feedback => {
    const s = byId(storyId);
    return { storyId, editionId: "x", writerId: s.writerId, topics: s.topics, towns: s.cities, vote };
  };

  it("ignores entries without a vote (swipes and opens are never recorded as votes)", () => {
    const t = tasteFromFeedback([fb("2026-10-09-lantern-coffee", null)]);
    expect(t).toEqual({ topics: {}, writers: {} });
  });
  it("caps adjustments so many downvotes can't erase a story", () => {
    const many = Array.from({ length: 20 }, () => fb("2026-10-09-north-star-hvac", "down"));
    const t = tasteFromFeedback(many);
    const adj = tasteAdjustment(byId("2026-10-09-north-star-hvac"), t);
    expect(adj).toBeGreaterThanOrEqual(-MAX_TASTE_ADJUSTMENT);
    const ids = assembleStoryIds(pool, JAKE, towns, many);
    expect(ids).toContain("2026-10-09-north-star-hvac");
  });
  it("never lets taste move a statewide story above or below a geography tier", () => {
    expect(BASE_SCORE.localMatch - BASE_SCORE.regionalMatch).toBeGreaterThan(MAX_TASTE_ADJUSTMENT * 2 - 1);
    expect(BASE_SCORE.regionalMatch - BASE_SCORE.statewide).toBeGreaterThanOrEqual(MAX_TASTE_ADJUSTMENT + 2);
  });
  it("upvotes nudge order within a tier", () => {
    const before = assembleStoryIds(pool, JAKE, towns, []);
    const ups = Array.from({ length: 3 }, () => fb("2026-10-09-hibbing-battery", "up"));
    const after = assembleStoryIds(pool, JAKE, towns, ups);
    expect(after.indexOf("2026-10-09-hibbing-battery")).toBeLessThanOrEqual(before.indexOf("2026-10-09-hibbing-battery"));
  });
});
