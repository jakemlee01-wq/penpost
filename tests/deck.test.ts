import { describe, expect, it } from "vitest";
import { keepDeck, needsPaperTap, poolSignature } from "../src/lib/useReader";

const deck = (over: Partial<Parameters<typeof keepDeck>[0]> = {}) => ({ storyIds: ["a", "b", "c", "d", "e"], index: 0, seen: [], frozenAt: "", ...over });

describe("frozen decks", () => {
  it("rebuilds an empty deck once the edition has stories", () => {
    expect(keepDeck(deck({ storyIds: [], poolSize: 0 }), 28)).toBe(false);
    expect(keepDeck(deck({ storyIds: [] }), 28)).toBe(false);
  });
  it("rebuilds an unstarted deck when the edition gained stories", () => {
    expect(keepDeck(deck({ storyIds: ["a"], poolSize: 1 }), 28)).toBe(false);
  });
  it("keeps a deck the reader has started, even if the edition grew", () => {
    expect(keepDeck(deck({ storyIds: ["a"], poolSize: 1, index: 1 }), 28)).toBe(true);
  });
  it("keeps an unstarted deck when nothing changed", () => {
    expect(keepDeck(deck({ poolSize: 28 }), 28)).toBe(true);
  });
  it("handles decks saved before this fix", () => {
    expect(keepDeck(deck(), 28)).toBe(true);
    expect(keepDeck(deck({ storyIds: ["a"] }), 28)).toBe(false);
  });
  it("rebuilds an unstarted deck when stories are re-tagged, but not once started", () => {
    const a = poolSignature([{ id: "x", tone: "neutral", mustKnow: true }]);
    const b = poolSignature([{ id: "x", tone: "neutral", mustKnow: false }]);
    expect(a).not.toBe(b);
    expect(keepDeck(deck({ poolSize: 1, poolSig: a }), 1, b)).toBe(false);
    expect(keepDeck(deck({ poolSize: 1, poolSig: a, index: 2 }), 1, b)).toBe(true);
    expect(keepDeck(deck({ poolSize: 1, poolSig: a }), 1, a)).toBe(true);
    expect(keepDeck(deck({ poolSize: 28 }), 28, a)).toBe(false); // saved before fingerprints, unstarted: rebuild once
  });
});

describe("today's paper gate", () => {
  const base = { today: "2026-10-19", editionDate: "2026-10-16", hasDeck: false, asked: null, curating: null, topics: ["mn-business", "mn-feel-good"] };
  it("asks for a tap on a weekday with no deck for today", () => {
    expect(needsPaperTap(base)).toBe(true);
  });
  it("never gates on weekends, while curating, or once today's deck is frozen", () => {
    expect(needsPaperTap({ ...base, today: "2026-10-17" })).toBe(false);
    expect(needsPaperTap({ ...base, curating: { date: "2026-10-19", topics: [], startedAt: "x" } })).toBe(false);
    expect(needsPaperTap({ ...base, editionDate: "2026-10-19", hasDeck: true })).toBe(false);
    // A frozen deck for an older edition doesn't count.
    expect(needsPaperTap({ ...base, hasDeck: true })).toBe(true);
  });
  it("lets the deck build after today's tap, and asks again when settings add a topic", () => {
    const asked = { date: "2026-10-19", topics: ["mn-business", "mn-feel-good"] };
    expect(needsPaperTap({ ...base, asked })).toBe(false);
    expect(needsPaperTap({ ...base, asked: { ...asked, failed: true } })).toBe(false);
    expect(needsPaperTap({ ...base, asked, topics: [...base.topics, "mn-sports"] })).toBe(true);
    expect(needsPaperTap({ ...base, asked: { ...asked, date: "2026-10-16" } })).toBe(true);
  });
});
