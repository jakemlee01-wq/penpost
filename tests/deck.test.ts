import { describe, expect, it } from "vitest";
import { keepDeck, poolSignature } from "../src/lib/useReader";

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
