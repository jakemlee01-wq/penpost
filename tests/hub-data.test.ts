// @vitest-environment node
import { describe, expect, it } from "vitest";
import { ctDate, ctInstant } from "../hub/src/chicago";
import { REFRESH_CONTRACTS, buildToday, countText, feedState, isFresh, type DomainId } from "../hub/src/contract";
import { fixtureFeeds, type FixtureScenario } from "../hub/src/fixtures";
import { esc, renderDomain, renderError, renderGlance } from "../hub/src/render";
import { NOW } from "./hubHelpers";

const view = (s: FixtureScenario, now = NOW) => buildToday(fixtureFeeds(s, now), now, { example: true });
const glance = (s: FixtureScenario) => renderGlance(view(s), "owner@example.com");
const domain = (s: FixtureScenario, id: DomainId) => renderDomain(view(s), id, "owner@example.com")!;
const dom = (s: FixtureScenario, id: DomainId) => view(s).domains.find((d) => d.id === id)!;
const ALL: FixtureScenario[] = ["normal", "empty", "stale", "missing_write", "outage", "partial", "not_connected"];

describe("Chicago dates", () => {
  it("uses the Chicago date, not UTC, including in the title", () => {
    const late = new Date("2026-11-10T05:30:00Z"); // 11:30 PM Nov 9 in Chicago
    expect(ctDate(late)).toBe("2026-11-09");
    expect(renderGlance(buildToday(fixtureFeeds("normal", late), late), "o@example.com")).toContain("<h1>Today - Mon Nov 9</h1>");
  });
  it("handles daylight saving dates", () => {
    expect(ctInstant("2026-07-01", "09:00").toISOString()).toBe("2026-07-01T14:00:00.000Z");
    expect(ctInstant("2026-11-09", "09:00").toISOString()).toBe("2026-11-09T15:00:00.000Z");
  });
});

describe("glance hierarchy", () => {
  const html = glance("normal");

  it("title is 'Today - <day>' and is the first heading", () => {
    const first = /<h([1-6])[^>]*>([^<]*)<\/h\1>/.exec(html);
    expect(first?.[1]).toBe("1");
    expect(first?.[2]).toBe("Today - Mon Nov 9");
  });

  it("hero holds the morning message and calendar, before the next thing and the cards", () => {
    const iMorning = html.indexOf("Good morning.");
    const iCal = html.indexOf("Stand-up with the sample team");
    const iNext = html.indexOf('class="next"');
    const iCards = html.indexOf('class="cards"');
    expect(iMorning).toBeGreaterThan(0);
    expect(iMorning).toBeLessThan(iNext);
    expect(iCal).toBeLessThan(iNext);
    expect(iNext).toBeLessThan(iCards);
  });

  it("shows exactly one next thing with a quiet count and one link to the rest", () => {
    expect((html.match(/class="next-label"/g) ?? []).length).toBe(1);
    expect(html).toContain("Sample invoice is ready to send");
    expect(html).toContain("1 thing needs you, 4 more later.");
    expect(html).toContain("4 more in Task list");
    // Other tasks are not on the glance surface.
    for (const t of ["Example recruiter reply is due Wednesday", "Placeholder domain renews Friday", "Fictional team lunch has no date yet"]) expect(html).not.toContain(t);
  });

  it("has five domain cards, in order", () => {
    const names = [...html.matchAll(/<span class="card-name">([^<]+)<\/span>/g)].map((m) => m[1]);
    expect(names).toEqual(["Today", "Jobs", "More Juice", "BreakerOps", "Money"]);
  });

  it("has no buttons, status pills or banned labels on the glance surface", () => {
    expect(html).not.toMatch(/<button/);
    for (const pill of [">To do<", ">In progress<", ">Stuck<", "class=\"status"]) expect(html).not.toContain(pill);
    for (const bad of ["operating layer", "scorecard", "ask box"]) expect(html.toLowerCase()).not.toContain(bad);
  });

  it("shows readable provenance for the morning message, calendar and next thing", () => {
    expect(html).toContain("Morning message · written 6:45 AM");
    expect(html).toContain("Calendar · checked 7:00 AM");
    expect(html).toContain("Task list · changed 6:40 AM · checked 7:00 AM");
  });

  it("labels fixture data as examples", () => {
    expect(html).toContain("Example data. Everything here is invented.");
  });

  it("no em dashes anywhere", () => {
    for (const s of ALL) {
      expect(glance(s)).not.toMatch(/—|&mdash;/);
      expect(domain(s, "today")).not.toMatch(/—|&mdash;/);
    }
  });

  it("has no inline scripts, styles or handlers (strict CSP)", () => {
    for (const page of [html, domain("normal", "money"), renderError("signed_out")]) {
      expect(page).not.toMatch(/<script>(?!<\/script>)/);
      expect(page).not.toMatch(/\sstyle="/);
      expect(page).not.toMatch(/\son[a-z]+="/);
    }
  });
});

describe("domain states", () => {
  it("normal day shows a fact, a quiet domain and a late domain distinctly", () => {
    expect(dom("normal", "jobs").state.kind).toBe("ok");
    expect(dom("normal", "more-juice").state.kind).toBe("quiet");
    expect(dom("normal", "money").state.kind).toBe("late");
    const html = glance("normal");
    expect(html).toContain("Waiting to hear back from Example Co.");
    expect(html).toMatch(/More Juice<\/span>\s*<span class="card-fact">Quiet\.<\/span>\s*<span class="card-prov">checked 7:00 AM/);
    expect(html).toContain("No update yet from the money summary.");
  });

  it("quiet needs a recent check; a stale feed with no items is late, not quiet", () => {
    const html = glance("normal");
    const money = html.slice(html.indexOf(">Money<"));
    expect(money).not.toMatch(/^[^]*?card-fact">Quiet/);
    expect(money).toContain("last checked Sat, Nov 7, 7:00 AM");
    // Full detail lives one tap behind.
    expect(domain("normal", "money")).toContain("Last checked Sat, Nov 7, 7:00 AM.");
  });

  it("keeps quiet, late, unreachable and not connected distinct", () => {
    expect(dom("empty", "jobs").state.kind).toBe("quiet");
    expect(dom("normal", "money").state.kind).toBe("late");
    expect(dom("outage", "jobs").state.kind).toBe("unreachable");
    expect(dom("not_connected", "jobs").state.kind).toBe("not_connected");
    expect(glance("outage")).toContain("Could not reach the job tracker just now.");
    expect(glance("not_connected")).toContain("The job tracker is not connected yet.");
  });

  it("domain pages hold the tasks, one tap behind, with provenance and the flag", () => {
    const money = domain("normal", "money");
    expect(money).toContain("<h1>Money</h1>");
    expect(money).toContain("Sample invoice is ready to send");
    expect(money).toContain("Needs you now");
    expect(money).toContain("From Task list · changed 6:40 AM · checked 7:00 AM");
    expect(money).toContain("Flags are not sent anywhere yet.");
    const list = domain("normal", "today");
    expect(list).toContain("<h1>Task list</h1>");
    expect((list.match(/<li class="task/g) ?? []).length).toBe(5);
    expect(renderDomain(view("normal"), "nope", "o@example.com")).toBeNull();
  });
});

describe("feeds, freshness and outages", () => {
  it("an old feed is late even if its records look recent", () => {
    // Feed checked 2 days ago; record says it changed this morning.
    const feed = { ok: true as const, checked_at: "2026-11-07T13:00:00Z", items: [{}] };
    expect(feedState(feed, REFRESH_CONTRACTS.jobs, NOW).kind).toBe("late");
    expect(feedState({ ...feed, checked_at: "2026-11-09T13:00:00Z" }, REFRESH_CONTRACTS.jobs, NOW).kind).toBe("ok");
  });

  it("stale calendar feed: entries hidden, says when it was last checked", () => {
    const v = view("stale");
    expect(v.calendar.state.kind).toBe("late");
    expect(v.calendar.entries).toEqual([]);
    const html = glance("stale");
    expect(html).not.toContain("Stand-up with the sample team");
    expect(html).toContain("No update yet from the calendar.");
    expect(html).toContain("Last checked Sun, Nov 8, 7:00 AM.");
  });

  it("stale record is not chosen as the next thing; a stale fact is marked last known", () => {
    const v = view("stale");
    expect(v.next?.id).toBe("t2");
    const html = glance("stale");
    expect(html).toContain("Last known: A sample customer asked about Thursday.");
    expect(html).toContain("May be out of date.");
    expect(domain("stale", "money")).toContain("Out of date. Check Task list before acting.");
  });

  it("missing daily write: no old list or morning message shown as current", () => {
    const v = view("missing_write");
    expect(v.tasks.state.kind).toBe("late");
    expect(v.next).toBeNull();
    expect(v.morning.state.kind).toBe("late");
    const html = glance("missing_write");
    expect(html).not.toContain("Sample invoice is ready to send");
    expect(html).toContain("No update yet from the task list.");
    expect(html).toContain("No update yet from the morning message.");
    expect(html).toContain("Stand-up with the sample team");
  });

  it("morning message states never silently vanish", () => {
    expect(glance("empty")).toContain("No morning message today.");
    expect(glance("outage")).toContain("Could not reach the morning message just now.");
    expect(glance("not_connected")).toContain("The morning message is not connected yet.");
  });

  it("empty day reads as quiet, not broken", () => {
    const html = glance("empty");
    expect(html).toContain("Nothing on the calendar today.");
    expect(html).toContain("Nothing needs you right now.");
    expect(html).toContain("Nothing open.");
  });

  it("partial outage: calendar stays visible when the tasks and cards fail", () => {
    const html = glance("partial");
    expect(html).toContain("Could not reach the task list just now.");
    expect(html).toContain("Could not reach the job tracker just now.");
    expect(html).toContain("Stand-up with the sample team");
    expect(html).toContain("Anytime");
  });

  it("full outage names each source that failed", () => {
    const html = glance("outage");
    for (const s of ["the morning message", "the calendar", "the task list", "the job tracker", "More Juice updates", "BreakerOps updates", "the money summary"]) {
      expect(html).toContain(esc(`Could not reach ${s} just now.`));
    }
  });

  it("refresh contracts exist for every source and invent no owners", () => {
    for (const c of Object.values(REFRESH_CONTRACTS)) {
      expect(c.owner).toBeNull();
      expect(c.max_feed_age_hours).toBeGreaterThan(0);
      expect(c.on_late).toBeTruthy();
      expect(c.on_failure).toBeTruthy();
    }
  });

  it("count wording", () => {
    expect(countText({ needs_you: 1, later: 4, total: 5 })).toBe("1 thing needs you, 4 more later.");
    expect(countText({ needs_you: 2, later: 0, total: 2 })).toBe("2 things need you.");
    expect(countText({ needs_you: 0, later: 3, total: 3 })).toBe("Nothing needs you right now. 3 for later.");
    expect(countText({ needs_you: 0, later: 0, total: 0 })).toBe("Nothing open.");
  });

  it("record freshness rules", () => {
    const base = { source_updated_at: "2026-11-09T12:00:00Z" };
    expect(isFresh({ ...base, freshness: { kind: "max_age", hours: 24 } }, NOW)).toBe(true);
    expect(isFresh({ ...base, freshness: { kind: "max_age", hours: 2 } }, NOW)).toBe(false);
    expect(isFresh({ source_updated_at: "2026-11-08T15:00:00Z", freshness: { kind: "daily_by", by_hour_ct: 8 } }, NOW)).toBe(false);
    expect(isFresh({ source_updated_at: "2026-11-08T15:00:00Z", freshness: { kind: "daily_by", by_hour_ct: 8 } }, new Date("2026-11-09T13:00:00Z"))).toBe(true);
    expect(isFresh({ source_updated_at: "2026-11-10T12:00:00Z", freshness: { kind: "max_age", hours: 999 } }, NOW)).toBe(false);
  });
});

describe("escaping", () => {
  it("escapes source text and only links https URLs", () => {
    const feeds = fixtureFeeds("normal", NOW);
    if (!feeds.tasks.ok) throw new Error("fixture");
    feeds.tasks.items[0] = { ...feeds.tasks.items[0], label: "<script>alert(1)</script>", body: '"><img src=x onerror=alert(1)>', source: { label: "X", record_ref: "r", url: "javascript:alert(1)" } };
    const v = buildToday(feeds, NOW);
    for (const out of [renderGlance(v, "o@example.com"), renderDomain(v, "money", "o@example.com")!]) {
      expect(out).not.toContain("<script>alert(1)");
      expect(out).not.toContain("<img src=x");
      expect(out).not.toContain("javascript:");
      expect(out).toContain(esc("<script>alert(1)</script>"));
    }
  });
});

describe("public-safe error pages", () => {
  it("use only the public stylesheet and carry nothing private", () => {
    for (const k of ["signed_out", "expired", "forbidden", "auth_down", "not_configured", "rate_limited", "not_found", "data_down"] as const) {
      const html = renderError(k);
      expect(html).toContain('href="/hub-public.css"');
      expect(html).not.toContain('href="/hub.css"');
      expect(html).not.toContain("/hub.js");
      for (const m of ["Sample invoice", "Stand-up", "Good morning", "@example.com"]) expect(html).not.toContain(m);
    }
  });
});
