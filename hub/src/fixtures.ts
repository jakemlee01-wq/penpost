/**
 * Synthetic fixtures. Every person, company, task, date and fact here is invented and the page shows
 * an "Example data" banner whenever fixtures are served. Links point at example.com.
 */
import { ctDate, ctInstant } from "./chicago";
import type { CalendarEntry, DomainFact, Feed, HubFeeds, MorningMessage, TaskItem } from "./contract";

export const FIXTURE_SCENARIOS = ["normal", "empty", "stale", "missing_write", "outage", "partial", "not_connected"] as const;
export type FixtureScenario = (typeof FIXTURE_SCENARIOS)[number];

const iso = (date: string, hhmm: string) => ctInstant(date, hhmm).toISOString();
const dayBefore = (date: string) => ctDate(new Date(ctInstant(date, "12:00").getTime() - 24 * 3_600_000));
const ref = (label: string, id: string, url?: string) => ({ label, record_ref: `fixture/${id}`, ...(url ? { url } : {}) });

function tasks(today: string): TaskItem[] {
  const checked = iso(today, "07:00");
  const t = (id: string, domain: TaskItem["domain"], label: string, body: string, status: TaskItem["status"], updated: string, url?: string): TaskItem => ({
    id,
    domain,
    label,
    body,
    status,
    source: ref("Task list", id, url),
    source_updated_at: iso(today, updated),
    checked_at: checked,
    freshness: { kind: "max_age", hours: 48 },
  });
  return [
    t("t1", "money", "Sample invoice is ready to send", "Example client Northwind Test Co. is waiting on it.", "needs_you", "06:40", "https://example.com/tasks/t1"),
    t("t2", "jobs", "Example recruiter reply is due Wednesday", "From the sample company in the fixture.", "later", "06:10"),
    t("t3", "more-juice", "Test label proof is with the printer", "They said Thursday.", "waiting", "05:55", "https://example.com/tasks/t3"),
    t("t4", "breakerops", "Placeholder domain renews Friday", "Auto-renew is on in the example.", "later", "06:00"),
    t("t5", "today", "Fictional team lunch has no date yet", "Any day next week works.", "later", "06:20"),
  ];
}

function calendar(today: string): CalendarEntry[] {
  return [
    { id: "c1", title: "Stand-up with the sample team", due_date: today, due_time: "09:00", source: ref("Calendar", "cal-1") },
    { id: "c2", title: "Pick up the test package", due_date: today, due_time: null, source: ref("Calendar", "cal-2") },
    { id: "c3", title: "Demo dry run", due_date: today, due_time: "14:30", source: ref("Calendar", "cal-3") },
    { id: "c0", title: "Yesterday's leftover entry", due_date: dayBefore(today), due_time: "10:00", source: ref("Calendar", "cal-0") },
  ];
}

function morning(date: string): MorningMessage[] {
  return [{ text: "Good morning. A light day: two meetings, one errand, and the sample invoice.", for_date: date, generated_at: iso(date, "06:45"), source: ref("Morning message", "morning-1") }];
}

function fact(today: string, id: string, text: string, label: string, updated = "06:30"): DomainFact[] {
  return [{ text, source: ref(label, id), source_updated_at: iso(today, updated), freshness: { kind: "max_age", hours: 48 } }];
}

export function fixtureFeeds(scenario: FixtureScenario, now: Date): HubFeeds {
  const today = ctDate(now);
  const checked = iso(today, "07:00");
  const ok = <T>(items: T[], written_for_date?: string, checked_at = checked): Feed<T> => ({ ok: true, checked_at, written_for_date, items });
  const down = <T>(reason: "unreachable" | "not_connected" = "unreachable"): Feed<T> =>
    reason === "unreachable" ? { ok: false, reason, last_checked_at: iso(dayBefore(today), "07:00") } : { ok: false, reason };

  const domains = {
    jobs: ok(fact(today, "jobs-1", "Waiting to hear back from Example Co.", "Job tracker")),
    "more-juice": ok<DomainFact>([]), // checked, nothing new: quiet
    breakerops: ok(fact(today, "bo-1", "A sample customer asked about Thursday.", "BreakerOps updates")),
    money: ok<DomainFact>([], undefined, iso(dayBefore(dayBefore(today)), "07:00")), // feed not checked recently: late
  };

  switch (scenario) {
    case "normal":
      return { morning: ok(morning(today), today), calendar: ok(calendar(today)), tasks: ok(tasks(today), today), domains };
    case "empty":
      return {
        morning: ok([], today),
        calendar: ok([]),
        tasks: ok([], today),
        domains: { jobs: ok([]), "more-juice": ok([]), breakerops: ok([]), money: ok([]) },
      };
    case "stale": {
      // Records unchanged for longer than their rules, and a calendar feed that was last checked yesterday.
      const list = tasks(today);
      list[0] = { ...list[0], source_updated_at: iso(dayBefore(dayBefore(dayBefore(today))), "09:00") };
      list[1] = { ...list[1], status: "needs_you" };
      const oldFact = fact(today, "bo-1", "A sample customer asked about Thursday.", "BreakerOps updates");
      oldFact[0] = { ...oldFact[0], source_updated_at: iso(dayBefore(dayBefore(dayBefore(today))), "09:00") };
      return {
        morning: ok(morning(today), today),
        calendar: ok(calendar(today), undefined, iso(dayBefore(today), "07:00")),
        tasks: ok(list, today),
        domains: { ...domains, breakerops: ok(oldFact) },
      };
    }
    case "missing_write":
      // Daily writes still carry yesterday's date.
      return { morning: ok(morning(dayBefore(today)), dayBefore(today)), calendar: ok(calendar(today)), tasks: ok(tasks(dayBefore(today)), dayBefore(today)), domains };
    case "outage":
      return { morning: down(), calendar: down(), tasks: down(), domains: { jobs: down(), "more-juice": down(), breakerops: down(), money: down() } };
    case "partial":
      return { morning: down(), calendar: ok(calendar(today)), tasks: down(), domains: { ...domains, jobs: down() } };
    case "not_connected": {
      const nc = <T>() => down<T>("not_connected");
      return { morning: nc(), calendar: nc(), tasks: nc(), domains: { jobs: nc(), "more-juice": nc(), breakerops: nc(), money: nc() } };
    }
  }
}
