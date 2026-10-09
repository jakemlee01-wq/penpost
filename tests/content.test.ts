import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { WriterSchema } from "../src/lib/schema";

const root = join(__dirname, "..");
const writers = WriterSchema.array().parse(JSON.parse(readFileSync(join(root, "content/writers/writers.json"), "utf8")));

describe("writers", () => {
  it("has exactly the five final writers with correct pronouns", () => {
    expect(writers.map((w) => [w.id, w.name, w.pronouns])).toEqual([
      ["emma", "Emma", "she/her"],
      ["jack", "Jack", "he/him"],
      ["grace", "Grace", "she/her"],
      ["luke", "Luke", "he/him"],
      ["ben", "Ben", "he/him"],
    ]);
  });
  it("labels every writer as AI and gives them the same full coverage", () => {
    for (const w of writers) {
      expect(w.isAI).toBe(true);
      expect(w.bio).toMatch(/designed editorial persona/);
      expect(w.beats).toEqual(["all"]);
      expect(w.potentialBias.length).toBeGreaterThan(0);
    }
  });
  it("has an avatar file for every writer", () => {
    const files = readdirSync(join(root, "src/assets/avatars"));
    for (const w of writers) expect(files).toContain(w.avatar);
  });
});

describe("preview card", () => {
  it("does not render a byline or avatar on the story card", () => {
    const deck = readFileSync(join(root, "src/views/Deck.tsx"), "utf8");
    expect(deck).not.toMatch(/<Avatar/);
    expect(deck).not.toMatch(/writerById|writer\.name/);
  });
  it("swipe handlers never call vote", () => {
    const deck = readFileSync(join(root, "src/views/Deck.tsx"), "utf8");
    const up = deck.slice(deck.indexOf("const onPointerUp"), deck.indexOf("return (", deck.indexOf("const onPointerUp")));
    expect(up).not.toContain(".vote(");
  });
});

describe("real edition", () => {
  it("has no demo stories or placeholder sources in published content", async () => {
    const { parseStoryFile } = await import("../src/lib/parse");
    const dir = join(root, "content/stories");
    for (const f of readdirSync(dir).filter((x) => x.endsWith(".md"))) {
      const s = parseStoryFile(readFileSync(join(dir, f), "utf8"), f);
      expect(s.isDemo, f).toBe(false);
      for (const src of s.sources) expect(src.url, f).not.toMatch(/example\.(com|org)/);
    }
  });
});
