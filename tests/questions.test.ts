import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { AreasSchema } from "../src/lib/areas";
import { parseStoryFile } from "../src/lib/parse";
import { answeredToday, questionFor, type Prefs, type QuestionContext } from "../src/lib/questions";
import { eligibility } from "../src/lib/ranking";
import { townsWithRegion, expandAreas } from "../src/lib/areas";
import { WriterSchema, type CategoryId } from "../src/lib/schema";

const root = join(__dirname, "..", "content");
const areas = AreasSchema.parse(JSON.parse(readFileSync(join(root, "areas.json"), "utf8")));
const writers = WriterSchema.array().parse(JSON.parse(readFileSync(join(root, "writers/writers.json"), "utf8")));
const pool = readdirSync(join(root, "stories"))
  .map((f) => parseStoryFile(readFileSync(join(root, "stories", f), "utf8"), f))
  .filter((s) => s.id.startsWith("2026-10-09-"));
const sectionNames = Object.fromEntries(
  (JSON.parse(readFileSync(join(root, "interests.json"), "utf8")).categories as { id: CategoryId; name: string }[]).map((c) => [c.id, c.name]),
) as Record<CategoryId, string>;

const jake: Prefs = {
  areas: ["region:twin-cities", "town:dawson"],
  interests: [
    { category: "business", scope: "minnesota" },
    { category: "economy", scope: "national" },
    { category: "technology", scope: "minnesota" },
    { category: "sports", scope: "minnesota" },
  ],
  // The way the setup parser really saves them: sports inside phrases, generic and specific likes side by side.
  likes: ["venture capital", "private equity", "value investing", "investing", "ai tools", "Minnesota basketball", "Minnesota football", "warren buffett"],
  avoids: ["soccer"],
  favoriteWriters: [],
};
const setupText = "I'm from Dawson Minnesota. If there's articles of Dawson Boyd high school I like hearing about it.";
const ctx = (prefs: Prefs): QuestionContext => ({ prefs, setupText, pool, deck: pool.slice(0, 5), areas, writers, sectionNames });

describe("daily question", () => {
  it("builds on the sports the reader named, even inside phrases, and never offers one they avoid", () => {
    const q = questionFor(ctx(jake), {}, "2026-10-13")!;
    expect(q.context).toBe("You said you're a fan of Minnesota basketball and football.");
    expect(q.options.map((o) => o.id)).not.toContain("add-soccer");
    const all = q.options.find((o) => o.id === "all")!;
    expect(all.label).toBe("All except soccer");
    expect(all.apply(jake).likes).toEqual(expect.arrayContaining(["hockey", "baseball", "golf"]));
  });

  it("asks about national news on the reader's own business likes, and a focused yes only widens to those", () => {
    const answers = { "sports-beyond:basketball,football": { option: "keep", date: "2026-10-13", note: "" } };
    const national = { ...pool[0], id: "x-nat", significance: "national" as const, categories: ["business" as const], topics: ["retail"], headline: "Retailer opens stores", preview: "" };
    const q = questionFor({ ...ctx(jake), pool: [...pool, national] }, answers, "2026-10-14")!;
    expect(q.id).toBe("scope-national:business");
    expect(q.context).toBe("You said you follow venture capital, private equity and value investing.");
    const focused = q.options.find((o) => o.id === "focus")!.apply(jake);
    const towns = townsWithRegion(areas);
    const t = expandAreas(focused.areas, areas);
    const vc = { ...national, id: "x-vc", headline: "Private equity firm buys chain" };
    expect(eligibility(national, t, towns, focused).eligible).toBe(false);
    expect(eligibility(vc, t, towns, focused).eligible).toBe(true);
  });

  it("moves on to the next question once one is answered, and asks only one a day", () => {
    const first = questionFor(ctx(jake), {}, "2026-10-13")!;
    const answers = { [first.id]: { option: "keep", date: "2026-10-13", note: "Got it." } };
    expect(questionFor(ctx(jake), answers, "2026-10-13")).toBeNull();
    expect(answeredToday(answers, "2026-10-13")).toBe("Got it.");
    const next = questionFor(ctx(jake), answers, "2026-10-14")!;
    expect(next.id).not.toBe(first.id);
  });

  it("offers a single town's county and region, in the reader's own words", () => {
    const p = { ...jake, interests: [{ category: "business" as const, scope: "national" as const }], likes: [] };
    const q = questionFor(ctx(p), {}, "2026-10-13")!;
    expect(q.id).toBe("home-area:dawson");
    expect(q.context).toBe("You said you're from Dawson.");
    expect(q.prompt).toContain("Dawson Boyd High School");
    expect(q.options.find((o) => o.id === "county")!.apply(p).areas).toContain("county:lac-qui-parle");
  });

  it("every answer either changes a setting or deliberately keeps it", () => {
    let answers = {};
    for (let day = 10; day < 20; day++) {
      const q = questionFor(ctx(jake), answers, `2026-10-${day}`);
      if (!q) break;
      for (const o of q.options) expect(o.apply(jake)).toBeTruthy();
      answers = { ...answers, [q.id]: { option: q.options[0].id, date: `2026-10-${day}`, note: "" } };
    }
    expect(Object.keys(answers).length).toBeGreaterThan(1);
  });
});
