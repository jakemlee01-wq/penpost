// @vitest-environment node
import { describe, expect, it } from "vitest";
import { ctDate, ctInstant } from "../hub/src/chicago";
import { buildToday, isFresh } from "../hub/src/contract";
import { fixtureFeeds } from "../hub/src/fixtures";
import { VISIBLE_ITEMS, esc, renderPage } from "../hub/src/render";
import { NOW } from "./hubHelpers";

const view = (s: Parameters<typeof fixtureFeeds>[0], now = NOW) => buildToday(fixtureFeeds(s, now), now);
const page = (s: Parameters<typeof fixtureFeeds>[0]) => renderPage(view(s), "owner@example.com");

describe("Chicago dates", () => {
  it("uses the Chicago date, not UTC", () => {
    // 11:30 PM Chicago on Nov 9 is already Nov 10 in UTC.
    const late = new Date("2026-11-10T05:30:00Z");
    expect(ctDate(late)).toBe("2026-11-09");
    expect(view("normal", late).today).toBe("2026-11-09");
  });
  it("handles daylight saving dates", () => {
    expect(ctInstant("2026-07-01", "09:00").toISOString()).toBe("2026-07-01T14:00:00.000Z");
    expect(ctInstant("2026-11-09", "09:00").toISOString()).toBe("2026-11-09T15:00:00.000Z");
  });
});

describe("hub data states", () => {
  it("normal day: list and calendar, today's entries only, timed first", () => {
    const v = view("normal");
    expect(v.next.state.kind).toBe("ok");
    expect(v.next.items.every((i) => i.fresh)).toBe(true);
    expect(v.calendar.entries.map((e) => e.id)).toEqual(["c1", "c3", "c2"]);
    expect(v.morning?.text).toContain("Good morning");
  });

  it("empty day says so, rather than looking broken", () => {
    const v = view("empty");
    expect(v.next.state.kind).toBe("empty");
    expect(v.calendar.state.kind).toBe("empty");
    const html = page("empty");
    expect(html).toContain("Nothing on the list today.");
    expect(html).toContain("Nothing on the calendar today.");
  });

  it("stale records are marked out of date, not presented as current", () => {
    const v = view("stale");
    expect(v.next.items.filter((i) => !i.fresh).map((i) => i.id)).toEqual(["n2", "n3"]);
    const html = page("stale");
    expect((html.match(/Out of date\./g) ?? []).length).toBe(2);
  });

  it("missing daily write shows nothing from yesterday's list as current", () => {
    const v = view("missing_write");
    expect(v.next.state.kind).toBe("not_updated");
    expect(v.next.items).toEqual([]);
    expect(v.morning).toBeNull();
    const html = page("missing_write");
    expect(html).toContain(esc("Today's list has not been written yet."));
    expect(html).not.toContain("Send the sample invoice");
    // Calendar still shows.
    expect(html).toContain("Stand-up with the sample team");
  });

  it("full outage says the sources could not be reached", () => {
    const v = view("outage");
    expect(v.next.state).toEqual({ kind: "unavailable", reason: "unreachable" });
    expect(v.calendar.state).toEqual({ kind: "unavailable", reason: "unreachable" });
    const html = page("outage");
    expect(html).toContain("Could not reach the list just now.");
    expect(html).toContain("Could not reach the calendar just now.");
  });

  it("partial outage: calendar stays visible when the cards fail", () => {
    const html = page("partial");
    expect(html).toContain("Could not reach the list just now.");
    expect(html).toContain("Stand-up with the sample team");
    expect(html).toContain("Anytime");
  });

  it("not connected is its own message", () => {
    expect(page("not_connected")).toContain("The list is not connected yet.");
  });

  it("freshness rules", () => {
    const base = { source_updated_at: "2026-11-09T12:00:00Z" };
    expect(isFresh({ ...base, freshness: { kind: "max_age", hours: 24 } }, NOW)).toBe(true);
    expect(isFresh({ ...base, freshness: { kind: "max_age", hours: 2 } }, NOW)).toBe(false);
    // Updated yesterday; daily_by 8 AM has passed at 10:30 AM.
    expect(isFresh({ source_updated_at: "2026-11-08T15:00:00Z", freshness: { kind: "daily_by", by_hour_ct: 8 } }, NOW)).toBe(false);
    // Same record at 7 AM is still acceptable.
    expect(isFresh({ source_updated_at: "2026-11-08T15:00:00Z", freshness: { kind: "daily_by", by_hour_ct: 8 } }, new Date("2026-11-09T13:00:00Z"))).toBe(true);
    // A timestamp from the future is not trusted.
    expect(isFresh({ source_updated_at: "2026-11-10T12:00:00Z", freshness: { kind: "max_age", hours: 999 } }, NOW)).toBe(false);
  });
});

describe("hub page", () => {
  const html = page("normal");

  it("first heading is 'What needs me next?'", () => {
    const first = /<h([1-6])[^>]*>([^<]*)<\/h\1>/.exec(html);
    expect(first?.[1]).toBe("1");
    expect(first?.[2]).toBe("What needs me next?");
  });

  it("shows at most five items before 'Show more'", () => {
    const [before] = html.split('<details class="more">');
    expect((before.match(/<li class="item/g) ?? []).length).toBe(VISIBLE_ITEMS);
    expect(html).toContain("Show 2 more");
  });

  it("uses readable status labels and no banned labels or em dashes", () => {
    for (const s of ["To do", "Waiting on someone", "In progress", "Stuck"]) expect(html).toContain(s);
    for (const bad of ["operating layer", "scorecard", "ask box"]) expect(html.toLowerCase()).not.toContain(bad);
    for (const s of ["normal", "empty", "stale", "missing_write", "outage", "partial", "not_connected"] as const) {
      expect(page(s)).not.toMatch(/—|&mdash;/);
    }
  });

  it("flag sheet says plainly that nothing is sent", () => {
    expect(html).toContain("Flags are not sent anywhere yet.");
    expect(html).toContain('class="flag"');
  });

  it("escapes source text and only links https URLs", () => {
    const feeds = fixtureFeeds("normal", NOW);
    if (!feeds.next.ok) throw new Error("fixture");
    feeds.next.items[0] = { ...feeds.next.items[0], label: '<script>alert(1)</script>', body: '"><img src=x onerror=alert(1)>', source: { label: "X", record_ref: "r", url: "javascript:alert(1)" } };
    const out = renderPage(buildToday(feeds, NOW), "owner@example.com");
    expect(out).not.toContain("<script>alert(1)");
    expect(out).not.toContain("<img src=x");
    expect(out).not.toContain("javascript:");
    expect(out).toContain(esc("<script>alert(1)</script>"));
  });

  it("has no inline scripts or styles (works under the strict CSP)", () => {
    expect(html).not.toMatch(/<script>(?!<\/script>)/);
    expect(html).not.toMatch(/\sstyle="/);
    expect(html).not.toMatch(/\son[a-z]+="/);
  });
});
