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
  it("starts with no places so a new visitor is asked", () => {
    expect(loadState().prefs.areas).toEqual([]);
  });
  it("persists picks across reloads", () => {
    const s = loadState();
    saveState({ ...s, prefs: { ...s.prefs, areas: ["region:twin-cities", "town:dawson"] } });
    _resetMemory();
    expect(loadState().prefs.areas).toEqual(["region:twin-cities", "town:dawson"]);
  });
  it("survives corrupted storage", () => {
    localStorage.setItem(STORAGE_KEY, "{not json");
    expect(loadState().prefs.areas).toEqual([]);
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
  it("drops invalid interests, writers and old mood settings from saved data", () => {
    const st = sanitize({
      prefs: { areas: ["town:dawson"], interests: [{ category: "sports", scope: "minnesota" }, { category: "astrology", scope: "national" }], mood: 0, favoriteWriters: ["jack", "zed"] },
    });
    expect(st.prefs.interests).toEqual([{ category: "sports", scope: "minnesota" }]);
    expect("mood" in st.prefs).toBe(false);
    expect(st.prefs.favoriteWriters).toEqual(["jack"]);
  });
  it("treats saves from the old two-step setup as already set up", () => {
    expect(sanitize({ prefs: { areas: ["town:dawson"], interests: [{ category: "business", scope: "minnesota" }] } }).prefs.setup?.source).toBe("manual");
    expect(sanitize({ prefs: { areas: ["town:dawson"] } }).prefs.setup).toBeNull();
  });
  it("cleans likes and dislikes, and a phrase can't be both", () => {
    const st = sanitize({ prefs: { likes: ["Value Investing", "soccer", 7, "x"], avoids: ["Soccer", "<b>crime</b>"] } });
    expect(st.prefs.likes).toEqual(["value investing"]);
    expect(st.prefs.avoids).toEqual(["soccer", "crime"]);
  });
  it("upgrades older saves that stored plain town IDs", () => {
    expect(sanitize({ prefs: { towns: ["minneapolis", "dawson"] } }).prefs.areas).toEqual(["minneapolis", "dawson"]);
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
