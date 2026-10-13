import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { AreasSchema } from "../src/lib/areas";
import { parseStoryFile } from "../src/lib/parse";
import { answeredToday, questionFor, type Prefs, type QuestionContext } from "../src/lib/questions";
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
  likes: ["football", "basketball", "value investing"],
  avoids: ["soccer"],
  favoriteWriters: [],
};
const ctx = (prefs: Prefs): QuestionContext => ({ prefs, pool, deck: pool.slice(0, 5), areas, writers, sectionNames });

describe("daily question", () => {
  it("asks about sports beyond the ones the reader named, never offering one they avoid", () => {
    const q = questionFor(ctx(jake), {}, "2026-10-13")!;
    expect(q.prompt).toBe("Want Minnesota sports beyond football and basketball?");
    expect(q.options.map((o) => o.label).join("|")).not.toMatch(/soccer/i);
    const all = q.options.find((o) => o.id === "all")!.apply(jake);
    expect(all.likes).toEqual(expect.arrayContaining(["hockey", "baseball", "golf"]));
    expect(all.likes).not.toContain("soccer");
  });

  it("moves on to the next question once one is answered, and asks only one a day", () => {
    const first = questionFor(ctx(jake), {}, "2026-10-13")!;
    const answers = { [first.id]: { option: "keep", date: "2026-10-13", note: "Got it." } };
    expect(questionFor(ctx(jake), answers, "2026-10-13")).toBeNull();
    expect(answeredToday(answers, "2026-10-13")).toBe("Got it.");
    const next = questionFor(ctx(jake), answers, "2026-10-14")!;
    expect(next.id).not.toBe(first.id);
  });

  it("offers a single town's county and region", () => {
    const p = { ...jake, interests: [{ category: "business" as const, scope: "national" as const }], likes: [] };
    const q = questionFor(ctx(p), {}, "2026-10-13")!;
    expect(q.id).toBe("home-area:dawson");
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
