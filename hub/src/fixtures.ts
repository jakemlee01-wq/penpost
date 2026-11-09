/**
 * Synthetic fixtures for stage 1A. Every name, task and link here is invented.
 * Nothing is copied from a real person, calendar or project. Links point at example.com.
 */
import { ctDate, ctInstant } from "./chicago";
import type { CalendarEntry, Feed, HubFeeds, HubItem, MorningMessage } from "./contract";

export const FIXTURE_SCENARIOS = ["normal", "empty", "stale", "missing_write", "outage", "partial", "not_connected"] as const;
export type FixtureScenario = (typeof FIXTURE_SCENARIOS)[number];

function iso(date: string, hhmm: string): string {
  return ctInstant(date, hhmm).toISOString();
}

function dayBefore(date: string): string {
  return ctDate(new Date(ctInstant(date, "12:00").getTime() - 24 * 3_600_000));
}

function items(today: string): HubItem[] {
  const checked = iso(today, "07:00");
  const src = (label: string, ref: string, url?: string) => ({ label, record_ref: `fixture/${ref}`, ...(url ? { url } : {}) });
  return [
    { id: "n1", label: "Send the sample invoice", body: "Fictional client Northwind Test Co. is waiting on it.", status: "todo", source: src("Task list", "task-101", "https://example.com/tasks/101"), source_updated_at: iso(today, "06:40"), checked_at: checked, freshness: { kind: "daily_by", by_hour_ct: 8 } },
    { id: "n2", label: "Call back the test supplier", body: "They asked for a time this week.", status: "waiting", source: src("Inbox notes", "note-7"), source_updated_at: iso(today, "06:10"), checked_at: checked, freshness: { kind: "max_age", hours: 24 } },
    { id: "n3", label: "Finish the demo slide", body: "Two charts left.", status: "in_progress", source: src("Task list", "task-102", "https://example.com/tasks/102"), source_updated_at: iso(today, "05:55"), checked_at: checked, freshness: { kind: "daily_by", by_hour_ct: 8 } },
    { id: "n4", label: "Renew the placeholder domain", body: "Expires Friday.", status: "todo", source: src("Task list", "task-103"), source_updated_at: iso(today, "06:00"), checked_at: checked, freshness: { kind: "max_age", hours: 48 } },
    { id: "n5", label: "Review the sample contract", body: "Stuck until the other side sends page 3.", status: "blocked", source: src("Task list", "task-104"), source_updated_at: iso(today, "06:05"), checked_at: checked, freshness: { kind: "max_age", hours: 72 } },
    { id: "n6", label: "Book the fictional team lunch", body: "Pick a day next week.", status: "todo", source: src("Task list", "task-105"), source_updated_at: iso(today, "06:20"), checked_at: checked, freshness: { kind: "max_age", hours: 72 } },
    { id: "n7", label: "Water the test plant", body: "Every Monday.", status: "scheduled", source: src("Task list", "task-106"), source_updated_at: iso(today, "06:25"), checked_at: checked, freshness: { kind: "max_age", hours: 168 } },
  ];
}

function calendar(today: string): CalendarEntry[] {
  const checked = iso(today, "07:00");
  const src = (ref: string) => ({ label: "Calendar", record_ref: `fixture/cal-${ref}` });
  return [
    { id: "c1", title: "Stand-up with the sample team", due_date: today, due_time: "09:00", source: src("1"), checked_at: checked },
    { id: "c2", title: "Pick up the test package", due_date: today, due_time: null, source: src("2"), checked_at: checked },
    { id: "c3", title: "Demo dry run", due_date: today, due_time: "14:30", source: src("3"), checked_at: checked },
    { id: "c0", title: "Yesterday's leftover entry", due_date: dayBefore(today), due_time: "10:00", source: src("0"), checked_at: checked },
  ];
}

function morning(today: string): MorningMessage[] {
  return [{ text: "Good morning. Three things on the calendar and the invoice is first on the list.", for_date: today, generated_at: iso(today, "06:45"), source: { label: "Morning message", record_ref: "fixture/morning-1" } }];
}

export function fixtureFeeds(scenario: FixtureScenario, now: Date): HubFeeds {
  const today = ctDate(now);
  const checked_at = now.toISOString();
  const ok = <T>(list: T[], written_for_date?: string): Feed<T> => ({ ok: true, checked_at, written_for_date, items: list });
  const down = <T>(reason: "unreachable" | "not_connected" = "unreachable"): Feed<T> => ({ ok: false, checked_at, reason });

  switch (scenario) {
    case "normal":
      return { calendar: ok(calendar(today)), next: ok(items(today), today), morning: ok(morning(today)) };
    case "empty":
      return { calendar: ok([]), next: ok([], today), morning: ok(morning(today)) };
    case "stale": {
      // Today's write landed, but two records have not changed in longer than their rules allow.
      const list = items(today).slice(0, 4);
      list[1] = { ...list[1], source_updated_at: iso(dayBefore(dayBefore(today)), "09:00") };
      list[2] = { ...list[2], source_updated_at: iso(dayBefore(today), "06:00") };
      return { calendar: ok(calendar(today)), next: ok(list, today), morning: ok(morning(today)) };
    }
    case "missing_write":
      // The daily write is still yesterday's. Morning message is also yesterday's.
      return { calendar: ok(calendar(today)), next: ok(items(dayBefore(today)), dayBefore(today)), morning: ok(morning(dayBefore(today))) };
    case "outage":
      return { calendar: down(), next: down(), morning: down() };
    case "partial":
      return { calendar: ok(calendar(today)), next: down(), morning: down() };
    case "not_connected":
      return { calendar: down("not_connected"), next: down("not_connected"), morning: down("not_connected") };
  }
}
