import { beforeEach, describe, expect, it, vi } from "vitest";
import { chicagoDate, pickEdition, signOff } from "../src/lib/dates";
import { renderMarkdown } from "../src/lib/markdown";
import { parseHash } from "../src/lib/router";
import { _resetMemory, applyVote, defaultState, loadState, sanitize, saveState, STORAGE_KEY } from "../src/lib/storage";

const base = { storyId: "s1", editionId: "e1", writerId: "emma", topics: ["startups"], towns: ["minneapolis"] };

describe("votes", () => {
  it("sets, switches, and clears a vote", () => {
    let s = defaultState();
    s = applyVote(s, base, "up");
    expect(s.feedback.s1.vote).toBe("up");
    s = applyVote(s, base, "down");
    expect(s.feedback.s1.vote).toBe("down");
    s = applyVote(s, base, "down");
    expect(s.feedback.s1).toBeUndefined();
  });
  it("snapshots writer and topics at vote time", () => {
    const s = applyVote(defaultState(), base, "up");
    expect(s.feedback.s1).toMatchObject({ writerId: "emma", topics: ["startups"], towns: ["minneapolis"] });
  });
});

describe("storage", () => {
  beforeEach(() => {
    _resetMemory();
    localStorage.clear();
  });
  it("defaults to Minneapolis + Dawson", () => {
    expect(loadState().prefs.towns).toEqual(["minneapolis", "dawson"]);
  });
  it("persists across reloads", () => {
    const s = loadState();
    saveState({ ...s, prefs: { ...s.prefs, towns: ["duluth"] } });
    _resetMemory();
    expect(loadState().prefs.towns).toEqual(["duluth"]);
  });
  it("survives corrupted storage", () => {
    localStorage.setItem(STORAGE_KEY, "{not json");
    expect(loadState().prefs.towns).toEqual(["minneapolis", "dawson"]);
  });
  it("keeps working when storage throws", () => {
    const spy = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    const s = loadState();
    expect(() => saveState({ ...s, hintSeen: true })).not.toThrow();
    expect(loadState().hintSeen).toBe(true);
    spy.mockRestore();
  });
  it("sanitizes imported data and refuses an empty town list", () => {
    expect(sanitize({ prefs: { towns: [] } }).prefs.towns).toEqual(["minneapolis", "dawson"]);
    expect(sanitize(null)).toEqual(defaultState());
  });
});

describe("dates", () => {
  it("uses America/Chicago for the editorial date", () => {
    // 03:30 UTC on Oct 10 is still Oct 9 in Chicago (CDT, UTC-5)
    expect(chicagoDate(new Date("2026-10-10T03:30:00Z"))).toBe("2026-10-09");
    // After DST ends (CST, UTC-6)
    expect(chicagoDate(new Date("2026-11-10T05:30:00Z"))).toBe("2026-11-09");
  });
  it("shows the latest real edition on a weekend instead of inventing one", () => {
    const eds = [{ date: "2026-10-08" }, { date: "2026-10-09" }];
    expect(pickEdition(eds, "2026-10-11")?.date).toBe("2026-10-09");
  });
  it("says see you Monday on Friday and weekends", () => {
    expect(signOff("2026-10-09", "2026-10-09")).toBe("See you Monday.");
    expect(signOff("2026-10-09", "2026-10-10")).toBe("See you Monday.");
    expect(signOff("2026-10-07", "2026-10-07")).toBe("See you tomorrow.");
  });
});

describe("routing and markdown", () => {
  it("parses hash routes", () => {
    expect(parseHash("#/story/abc")).toEqual({ name: "story", slug: "abc" });
    expect(parseHash("#/writer/ben")).toEqual({ name: "writer", id: "ben" });
    expect(parseHash("")).toEqual({ name: "deck" });
  });
  it("strips scripts and unsafe link protocols", () => {
    const html = renderMarkdown("Hi <script>alert(1)</script> [x](javascript:alert(1)) [y](https://ok.example)");
    expect(html).not.toContain("<script");
    expect(html).not.toContain("javascript:");
    expect(html).toContain('href="https://ok.example"');
    expect(html).toContain('rel="noopener noreferrer"');
  });
});
