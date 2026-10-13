import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it } from "vitest";
import { AreasSchema, expandAreas, townsWithRegion } from "../src/lib/areas";
import { parseStoryFile } from "../src/lib/parse";
import { assembleStoryIds, eligibility, scoreStories, type ReaderProfile } from "../src/lib/ranking";
import type { Story } from "../src/lib/schema";
import { runSetup } from "../src/lib/setupClient";
import { finalizeSetup, localParse, NOTICE_BUILT, NOTICE_STARTER, SETUP_EXAMPLE, STARTER_INTERESTS } from "../src/lib/setupParse";
import { defaultState } from "../src/lib/storage";
import type { Reader } from "../src/lib/useReader";
import { Onboarding } from "../src/views/Onboarding";

const root = join(__dirname, "..");
const areas = AreasSchema.parse(JSON.parse(readFileSync(join(root, "content", "areas.json"), "utf8")));
const towns = townsWithRegion(areas);
const dir = join(root, "content", "stories");
const pool: Story[] = readdirSync(dir).filter((f) => f.endsWith(".md")).map((f) => parseStoryFile(readFileSync(join(dir, f), "utf8"), f))
  // Pin to the fixed Oct 9 sample stories so daily editions can't change what these tests check.
  .filter((s) => s.id.startsWith("2026-10-09-"));
const byId = (id: string) => pool.find((s) => s.id === id)!;
const profile = (over: Partial<ReaderProfile> = {}): ReaderProfile => ({
  towns: expandAreas(["region:twin-cities"], areas),
  interests: [{ category: "business", scope: "minnesota" }],
  likes: [],
  avoids: [],
  favoriteWriters: [],
  ...over,
});

function renderSetup(): string {
  const reader = { state: defaultState(), completeSetup: () => {} } as unknown as Reader;
  return renderToStaticMarkup(createElement(Onboarding, { reader }));
}

describe("setup screen", () => {
  afterEach(() => {
    delete (window as unknown as Record<string, unknown>).webkitSpeechRecognition;
  });

  it("is one screen with one free-text input and one button", () => {
    const html = renderSetup();
    expect(html.match(/<textarea/g)).toHaveLength(1);
    expect(html).not.toMatch(/<input/);
    expect(html.match(/<button/g)).toHaveLength(1);
    expect(html).toContain("Show my edition");
    expect(html).not.toMatch(/Step \d of/);
  });
  it("shows an example answer", () => {
    expect(renderSetup()).toContain("vintage pyrex");
  });
  it("has no mood control and no writer picks", () => {
    const html = renderSetup();
    expect(html).not.toMatch(/radiogroup|Lighter|Balanced|How should the day feel/i);
    for (const name of ["Emma", "Jack", "Grace", "Luke", "Ben"]) expect(html).not.toContain(name);
    const src = readFileSync(join(root, "src/views/Onboarding.tsx"), "utf8");
    expect(src).not.toMatch(/AreaPicker|InterestPicker|WriterPicker|MoodPicker|mood/);
  });
  it("offers a mic button when the browser can transcribe speech", () => {
    (window as unknown as Record<string, unknown>).webkitSpeechRecognition = class {};
    const html = renderSetup();
    expect(html).toContain('aria-label="Speak your answer"');
    expect(html.match(/<textarea/g)).toHaveLength(1);
  });
  it("the mood setting is gone from the whole app", () => {
    const files = ["src/views/Pages.tsx", "src/components/InterestPicker.tsx", "src/lib/storage.ts", "src/lib/ranking.ts", "src/lib/schema.ts"];
    for (const f of files) expect(readFileSync(join(root, f), "utf8"), f).not.toMatch(/MoodPicker|\bMood\b|prefs\.mood/);
  });
});

describe("reading the answer", () => {
  it("reads the on-screen example: teams, a part of the metro, lake country and niche hobbies", () => {
    const p = localParse(SETUP_EXAMPLE, areas);
    expect(p.areas).toEqual(expect.arrayContaining(["county:hennepin", "town:brainerd"]));
    expect(p.areas).not.toContain("region:twin-cities");
    expect(p.interests.map((i) => i.category)).toEqual(expect.arrayContaining(["sports", "food", "culture", "politics"]));
    expect(p.likes).toEqual(expect.arrayContaining(["timberwolves", "minnesota wild", "schools", "state fair", "pyrex"]));
    // "I never miss the state fair" is a like, and "don't really care about politics but wanna know
    // what's going on" keeps politics in lightly. Neither is a dislike.
    expect(p.avoids).toEqual([]);
  });
  it("still treats a plain dislike as a dislike", () => {
    const p = localParse("I love the Vikings but I don't care about politics.", areas);
    expect(p.interests.map((i) => i.category)).not.toContain("politics");
    expect(p.avoids).toContain("politics");
  });
  it("turns a business-minded answer into sections, niche likes and a dislike", () => {
    const text =
      "I follow entrepreneurship, VC and private equity in Minnesota, and nationally I like to keep a sense of how the economy is doing. I'm into value investing and follow Warren Buffett and Berkshire Hathaway. I like technology, especially new AI tools I can actually try. I'm a big fan of Minnesota basketball and football, but I don't really care about soccer.";
    const p = localParse(text, areas);
    expect(p.interests).toEqual(
      expect.arrayContaining([
        { category: "business", scope: "minnesota" },
        { category: "economy", scope: "national" },
        { category: "technology", scope: "minnesota" },
        { category: "sports", scope: "minnesota" },
      ]),
    );
    expect(p.likes).toEqual(expect.arrayContaining(["venture capital", "private equity", "value investing", "berkshire hathaway", "warren buffett", "ai tools"]));
    expect(p.avoids).toEqual(["soccer"]);
    expect(p.likes).not.toContain("soccer");
  });
  it("maps places to the catalog: Twin Cities is the metro, Minnesota alone is statewide", () => {
    expect(localParse("I live in the Twin Cities and grew up near Dawson", areas).areas).toEqual(["region:twin-cities", "town:dawson"]);
    expect(localParse("Minnesota business and sports", areas).areas).toEqual([]);
  });
  it("defaults to statewide when no place is mentioned, without blocking", () => {
    const result = finalizeSetup(localParse("startups and the economy", areas), "basic");
    expect(result.prefs.areas).toEqual([]);
    expect(result.notice).toBe(NOTICE_BUILT);
    const ids = assembleStoryIds(pool, profile({ towns: expandAreas(result.prefs.areas, areas), interests: result.prefs.interests }), towns, []);
    expect(ids.length).toBeGreaterThan(0);
    for (const id of ids) expect(["statewide", "national"]).toContain(byId(id).significance);
  });
  it("falls back to Minnesota business and says so when nothing is usable", () => {
    const result = finalizeSetup(localParse("hello there", areas), "basic");
    expect(result.prefs.interests).toEqual(STARTER_INTERESTS);
    expect(result.source).toBe("starter");
    expect(result.notice).toBe(NOTICE_STARTER);
  });
});

describe("setup client", () => {
  const ok = (body: unknown) => (async () => new Response(JSON.stringify(body), { status: 200 })) as unknown as typeof fetch;

  it("uses the Worker's answer, keeping only real places and sections", async () => {
    const r = await runSetup("anything", areas, {
      url: "https://parser.test/parse",
      fetchImpl: ok({ areas: ["region:twin-cities", "town:atlantis"], interests: [{ category: "sports", scope: "minnesota" }, { category: "astrology" }], likes: ["Vikings"], avoids: ["soccer"] }),
    });
    expect(r.source).toBe("ai");
    expect(r.prefs).toEqual({ areas: ["region:twin-cities"], interests: [{ category: "sports", scope: "minnesota" }], likes: ["vikings"], avoids: ["soccer"] });
  });
  it("falls back to the in-browser parser when the Worker fails", async () => {
    const down = (async () => {
      throw new Error("offline");
    }) as unknown as typeof fetch;
    const r = await runSetup("Twin Cities startups", areas, { url: "https://parser.test/parse", fetchImpl: down });
    expect(r.source).toBe("basic");
    expect(r.prefs.areas).toEqual(["region:twin-cities"]);
  });
  it("an empty answer still lands on an edition, with the starter default disclosed", async () => {
    const r = await runSetup("   ", areas);
    expect(r.prefs.interests).toEqual(STARTER_INTERESTS);
    expect(r.notice).toBe(NOTICE_STARTER);
  });
});

describe("dislikes", () => {
  const sportsFan = (avoids: string[]) => profile({ interests: [{ category: "sports", scope: "minnesota" }], avoids });

  it("down-weight a story but never remove it", () => {
    const plain = scoreStories(pool, sportsFan([]), towns, { topics: {}, writers: {} });
    const avoid = scoreStories(pool, sportsFan(["football"]), towns, { topics: {}, writers: {} });
    const score = (arr: typeof plain) => arr.find((x) => x.story.id === "2026-10-09-vikings-4-0")?.score;
    expect(score(avoid)).toBeDefined();
    expect(score(avoid)!).toBeLessThan(score(plain)!);
    expect(assembleStoryIds(pool, sportsFan(["football"]), towns, [])).toContain("2026-10-09-vikings-4-0");
  });
  it("never decide eligibility", () => {
    const s = byId("2026-10-09-vikings-4-0");
    const a = sportsFan([]);
    const b = sportsFan(["football", "vikings", "sports"]);
    expect(eligibility(s, b.towns, towns, b)).toEqual(eligibility(s, a.towns, towns, a));
  });
  it("can't hide a must-know story", () => {
    const pool2 = pool.map((s) => (s.id === "2026-10-09-revol-greens" ? { ...s, mustKnow: true } : s));
    const p = profile({ towns: expandAreas(["county:steele"], areas), avoids: ["agriculture", "jobs", "lettuce"] });
    expect(assembleStoryIds(pool2, p, towns, [])).toContain("2026-10-09-revol-greens");
  });
  it("likes lift matching stories within their tier", () => {
    const plain = scoreStories(pool, profile(), towns, { topics: {}, writers: {} });
    const liked = scoreStories(pool, profile({ likes: ["venture capital"] }), towns, { topics: {}, writers: {} });
    const score = (arr: typeof plain) => arr.find((x) => x.story.id === "2026-10-09-gudea")!.score;
    expect(score(liked)).toBeGreaterThan(score(plain));
  });
});
