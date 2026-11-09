/**
 * Hub data contract (proposal; no live sources are wired).
 *
 * The hub is a view of a whole world, organised by domain, not a task manager. Each domain shows one
 * current fact or an explicit state. Tasks sit one tap behind.
 *
 * Every value carries provenance. Two separate clocks decide whether something may be shown as current:
 *   1. the feed's checked_at must be within that source's refresh contract (max_feed_age_hours), and
 *   2. each record's source_updated_at must pass its own freshness rule.
 * An unchanged record inside an old feed is not "freshly checked". All dates are America/Chicago,
 * decided on the server. The hub never invents, rewrites or reorders source content.
 */
import { ctDate, ctDayShort, ctInstant, ctTime } from "./chicago";

export type DomainId = "today" | "jobs" | "more-juice" | "breakerops" | "money";

export const DOMAINS: { id: DomainId; name: string; sourceName: string }[] = [
  { id: "today", name: "Today", sourceName: "the task list" },
  { id: "jobs", name: "Jobs", sourceName: "the job tracker" },
  { id: "more-juice", name: "More Juice", sourceName: "More Juice updates" },
  { id: "breakerops", name: "BreakerOps", sourceName: "BreakerOps updates" },
  { id: "money", name: "Money", sourceName: "the money summary" },
];

export type FreshnessRule = { kind: "max_age"; hours: number } | { kind: "daily_by"; by_hour_ct: number };

export interface SourceRef {
  /** Readable source name shown on screen, e.g. "Calendar". */
  label: string;
  /** Link back to the record in its own tool. Only https links are rendered. */
  url?: string;
  /** Stable reference to the record in its source of truth. */
  record_ref: string;
}

/** "needs_you": waiting on Jake now. "later": his, but not now. "waiting": on someone else. */
export type TaskStatus = "needs_you" | "later" | "waiting";
export const STATUS_TEXT: Record<TaskStatus, string> = { needs_you: "Needs you now", later: "Later", waiting: "Waiting on someone else" };

export interface TaskItem {
  id: string;
  domain: DomainId;
  /** Declarative, e.g. "Sample invoice is ready to send". */
  label: string;
  body: string;
  status: TaskStatus;
  source: SourceRef;
  source_updated_at: string;
  checked_at: string;
  freshness: FreshnessRule;
}

export interface CalendarEntry {
  id: string;
  title: string;
  due_date: string;
  due_time: string | null;
  source: SourceRef;
}

/** Passed through verbatim from the canonical object behind the morning message. */
export interface MorningMessage {
  text: string;
  for_date: string;
  generated_at: string;
  source: SourceRef;
}

/** One current fact for a domain, written by that domain's source. */
export interface DomainFact {
  text: string;
  source: SourceRef;
  source_updated_at: string;
  freshness: FreshnessRule;
}

export type FailReason = "unreachable" | "not_connected" | "bad_data";

export type Feed<T> =
  | { ok: true; checked_at: string; written_for_date?: string; items: T[] }
  | { ok: false; checked_at?: string; last_checked_at?: string; reason: FailReason };

export interface HubFeeds {
  morning: Feed<MorningMessage>;
  calendar: Feed<CalendarEntry>;
  tasks: Feed<TaskItem>;
  domains: Record<Exclude<DomainId, "today">, Feed<DomainFact>>;
}

/**
 * Refresh contract per source. Owner is deliberately null until a person agrees to own it;
 * no source may be wired in stage 1B until owner, deadline and failure treatment are agreed.
 */
export interface RefreshContract {
  owner: string | null;
  /** Chicago time the daily write is due, "HH:MM". */
  deadline_ct: string;
  /** Feed must have been checked within this many hours to be shown as current. */
  max_feed_age_hours: number;
  /** True if the feed must be written for today's date to count. */
  daily: boolean;
  on_late: string;
  on_failure: string;
}

const LATE = "Show 'No update yet from <source>' and hide old content; never show it as current.";
const FAIL = "Show 'Could not reach <source>'; other sections keep working.";

export const REFRESH_CONTRACTS: Record<"morning" | "calendar" | "tasks" | Exclude<DomainId, "today">, RefreshContract> = {
  morning: { owner: null, deadline_ct: "07:00", max_feed_age_hours: 6, daily: true, on_late: LATE, on_failure: FAIL },
  calendar: { owner: null, deadline_ct: "06:00", max_feed_age_hours: 6, daily: false, on_late: LATE, on_failure: FAIL },
  tasks: { owner: null, deadline_ct: "07:00", max_feed_age_hours: 6, daily: true, on_late: LATE, on_failure: FAIL },
  jobs: { owner: null, deadline_ct: "07:00", max_feed_age_hours: 26, daily: false, on_late: LATE, on_failure: FAIL },
  "more-juice": { owner: null, deadline_ct: "07:00", max_feed_age_hours: 26, daily: false, on_late: LATE, on_failure: FAIL },
  breakerops: { owner: null, deadline_ct: "07:00", max_feed_age_hours: 26, daily: false, on_late: LATE, on_failure: FAIL },
  money: { owner: null, deadline_ct: "07:00", max_feed_age_hours: 26, daily: false, on_late: LATE, on_failure: FAIL },
};

/** Section states. Quiet, late, unreachable, unreadable and not connected are never merged. */
export type SectionState =
  | { kind: "ok" }
  | { kind: "quiet" } // checked recently, nothing to report
  | { kind: "late"; last_checked_at?: string; last_written_for?: string; due_ct: string; past_due: boolean }
  | { kind: "unreachable"; last_checked_at?: string }
  | { kind: "bad_data" }
  | { kind: "not_connected" };

export function isFresh(item: { source_updated_at: string; freshness: FreshnessRule }, now: Date): boolean {
  const updated = new Date(item.source_updated_at);
  if (Number.isNaN(updated.getTime()) || updated.getTime() > now.getTime() + 5 * 60_000) return false;
  const rule = item.freshness;
  if (rule.kind === "max_age") return now.getTime() - updated.getTime() <= rule.hours * 3_600_000;
  const today = ctDate(now);
  const cutoff = ctInstant(today, `${String(rule.by_hour_ct).padStart(2, "0")}:00`);
  if (now.getTime() >= cutoff.getTime()) return ctDate(updated) === today;
  const yesterday = ctDate(new Date(ctInstant(today).getTime() - 12 * 3_600_000));
  return ctDate(updated) === today || ctDate(updated) === yesterday;
}

export function feedState<T>(feed: Feed<T>, contract: RefreshContract, now: Date): SectionState {
  const today = ctDate(now);
  const past_due = now.getTime() >= ctInstant(today, contract.deadline_ct).getTime();
  if (!feed.ok) {
    if (feed.reason === "not_connected") return { kind: "not_connected" };
    if (feed.reason === "bad_data") return { kind: "bad_data" };
    return { kind: "unreachable", last_checked_at: feed.last_checked_at };
  }
  const checked = new Date(feed.checked_at).getTime();
  if (Number.isNaN(checked) || now.getTime() - checked > contract.max_feed_age_hours * 3_600_000 || checked > now.getTime() + 5 * 60_000) {
    return { kind: "late", last_checked_at: feed.checked_at, due_ct: contract.deadline_ct, past_due };
  }
  if (contract.daily && feed.written_for_date !== today) {
    return { kind: "late", last_checked_at: feed.checked_at, last_written_for: feed.written_for_date, due_ct: contract.deadline_ct, past_due };
  }
  return feed.items.length ? { kind: "ok" } : { kind: "quiet" };
}

export interface TaskView extends TaskItem {
  fresh: boolean;
  status_text: string;
}

export interface Provenance {
  source: string;
  checked_at?: string;
}

export interface DomainView {
  id: DomainId;
  name: string;
  sourceName: string;
  state: SectionState;
  fact: { text: string; fresh: boolean; source: SourceRef; source_updated_at: string } | null;
  checked_at?: string;
  tasks: TaskView[];
}

export interface TodayView {
  today: string;
  generated_at: string;
  example: boolean;
  morning: { state: SectionState; message: MorningMessage | null; checked_at?: string };
  calendar: { state: SectionState; entries: CalendarEntry[]; checked_at?: string };
  tasks: { state: SectionState; items: TaskView[]; checked_at?: string };
  next: TaskView | null;
  counts: { needs_you: number; later: number; total: number };
  domains: DomainView[];
}

function checkedAt<T>(f: Feed<T>): string | undefined {
  return f.ok ? f.checked_at : f.last_checked_at;
}

export function buildToday(feeds: HubFeeds, now: Date, opts: { example?: boolean } = {}): TodayView {
  const today = ctDate(now);

  const mState = feedState(feeds.morning, REFRESH_CONTRACTS.morning, now);
  let message: MorningMessage | null = null;
  let morningState = mState;
  if (mState.kind === "ok" && feeds.morning.ok) {
    message = feeds.morning.items.find((m) => m.for_date === today) ?? null;
    if (!message) morningState = { kind: "late", last_checked_at: feeds.morning.checked_at, due_ct: REFRESH_CONTRACTS.morning.deadline_ct, past_due: true };
  }

  // Calendar stands alone.
  let calState = feedState(feeds.calendar, REFRESH_CONTRACTS.calendar, now);
  let entries: CalendarEntry[] = [];
  if (calState.kind === "ok" && feeds.calendar.ok) {
    entries = feeds.calendar.items.filter((e) => e.due_date === today).sort((a, b) => (a.due_time ?? "99:99").localeCompare(b.due_time ?? "99:99"));
    if (!entries.length) calState = { kind: "quiet" };
  }

  const tState = feedState(feeds.tasks, REFRESH_CONTRACTS.tasks, now);
  const items: TaskView[] =
    tState.kind === "ok" && feeds.tasks.ok ? feeds.tasks.items.map((t) => ({ ...t, fresh: isFresh(t, now), status_text: STATUS_TEXT[t.status] ?? "Later" })) : [];
  const current = items.filter((t) => t.fresh);
  const next = current.find((t) => t.status === "needs_you") ?? null;
  const needs_you = current.filter((t) => t.status === "needs_you").length;
  const counts = { needs_you, later: items.length - needs_you, total: items.length };

  const domains: DomainView[] = DOMAINS.map((d) => {
    if (d.id === "today") return { ...d, state: tState, fact: null, checked_at: checkedAt(feeds.tasks), tasks: items };
    const feed = feeds.domains[d.id];
    const state = feedState(feed, REFRESH_CONTRACTS[d.id], now);
    const f = state.kind === "ok" && feed.ok ? feed.items[0] : undefined;
    return {
      ...d,
      state,
      fact: f ? { text: f.text, fresh: isFresh(f, now), source: f.source, source_updated_at: f.source_updated_at } : null,
      checked_at: checkedAt(feed),
      tasks: items.filter((t) => t.domain === d.id),
    };
  });

  return {
    today,
    generated_at: now.toISOString(),
    example: Boolean(opts.example),
    morning: { state: morningState, message, checked_at: checkedAt(feeds.morning) },
    calendar: { state: calState, entries, checked_at: checkedAt(feeds.calendar) },
    tasks: { state: tState, items, checked_at: checkedAt(feeds.tasks) },
    next,
    counts,
    domains,
  };
}

/** Plain text for a non-ok state. `source` is a readable name like "the calendar". */
export function stateText(state: SectionState, source: string, quiet: string, short = false): string {
  switch (state.kind) {
    case "ok":
      return "";
    case "quiet":
      return quiet;
    case "late": {
      if (short) return `No update yet from ${source}.`;
      const when = state.last_checked_at ? ` Last checked ${ctDayShort(new Date(state.last_checked_at))}, ${ctTime(new Date(state.last_checked_at))}.` : "";
      const due = state.past_due ? ` It was due by ${wall(state.due_ct)}.` : ` Due by ${wall(state.due_ct)}.`;
      return `No update yet from ${source}.${due}${when}`;
    }
    case "unreachable":
      return `Could not reach ${source} just now.`;
    case "bad_data":
      return `${cap(source)} sent something the hub could not read.`;
    case "not_connected":
      return `${cap(source)} is not connected yet.`;
  }
}

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function wall(hhmm: string): string {
  const [h, m] = hhmm.split(":").map(Number);
  return `${h % 12 === 0 ? 12 : h % 12}:${String(m).padStart(2, "0")} ${h >= 12 ? "PM" : "AM"}`;
}

export function countText(c: TodayView["counts"]): string {
  if (c.total === 0) return "Nothing open.";
  const later = c.total - c.needs_you;
  if (c.needs_you === 0) return `Nothing needs you right now. ${later} for later.`;
  const head = c.needs_you === 1 ? "1 thing needs you" : `${c.needs_you} things need you`;
  return later > 0 ? `${head}, ${later} more later.` : `${head}.`;
}
