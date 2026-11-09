/**
 * Hub data contract, stage 1A (proposal; no live sources are wired).
 *
 * Every item carries its provenance so the screen can say where it came from and how fresh it is.
 * Sources hand the hub raw feeds. The hub never invents, rewrites or reorders items: order is the
 * source's order (no recommendations yet). Freshness and "today" are decided here, server-side,
 * in America/Chicago.
 */
import { ctDate, ctDayShort, ctInstant } from "./chicago";

export type ItemStatus = "todo" | "waiting" | "in_progress" | "blocked" | "scheduled";

export const STATUS_LABEL: Record<ItemStatus, string> = {
  todo: "To do",
  waiting: "Waiting on someone",
  in_progress: "In progress",
  blocked: "Stuck",
  scheduled: "Scheduled",
};

/**
 * How old an item may be before the hub stops presenting it as current.
 * - max_age: source_updated_at must be within `hours`.
 * - daily_by: the item must have been updated today (Chicago) once `by_hour_ct` has passed;
 *   before that hour, yesterday's update still counts.
 */
export type FreshnessRule = { kind: "max_age"; hours: number } | { kind: "daily_by"; by_hour_ct: number };

export interface SourceRef {
  /** Readable source name shown on screen, e.g. "Calendar". */
  label: string;
  /** Link back to the record in its own tool, if it has one. Only https links are rendered. */
  url?: string;
  /** Stable reference to the record in its source of truth, e.g. "calendar_items/<id>". */
  record_ref: string;
}

export interface HubItem {
  id: string;
  label: string;
  body: string;
  status: ItemStatus;
  source: SourceRef;
  /** When the source record last changed (ISO 8601 with offset). */
  source_updated_at: string;
  /** When the hub's feed last confirmed this record (ISO 8601 with offset). */
  checked_at: string;
  freshness: FreshnessRule;
}

export interface CalendarEntry {
  id: string;
  title: string;
  /** Chicago date YYYY-MM-DD. */
  due_date: string;
  /** Chicago wall time "HH:MM", or null when untimed. */
  due_time: string | null;
  source: SourceRef;
  checked_at: string;
}

/**
 * The morning message is passed through verbatim from the canonical object that produces Jake's
 * morning message. The hub must never rewrite it. Shown only when `for_date` is today.
 */
export interface MorningMessage {
  text: string;
  for_date: string;
  generated_at: string;
  source: SourceRef;
}

/** What a source returns. `ok: false` means the source could not be reached or read. */
export type Feed<T> =
  | { ok: true; checked_at: string; written_for_date?: string; items: T[] }
  | { ok: false; checked_at: string; reason: "unreachable" | "not_connected" | "bad_data" };

export interface HubFeeds {
  calendar: Feed<CalendarEntry>;
  /** The daily "what needs me next" write. Must be written for today to be shown. */
  next: Feed<HubItem>;
  morning: Feed<MorningMessage>;
}

/** Section states the screen distinguishes. Never collapse these into one "nothing here". */
export type SectionState =
  | { kind: "ok" }
  | { kind: "empty" } // the source answered for today and there is nothing
  | { kind: "not_updated"; last_written_for?: string } // the daily write for today has not landed
  | { kind: "unavailable"; reason: "unreachable" | "not_connected" | "bad_data" };

export interface ItemView extends HubItem {
  status_label: string;
  fresh: boolean;
}

export interface TodayView {
  today: string;
  generated_at: string;
  morning: MorningMessage | null;
  next: { state: SectionState; items: ItemView[] };
  calendar: { state: SectionState; entries: CalendarEntry[] };
}

export function isFresh(item: Pick<HubItem, "source_updated_at" | "freshness">, now: Date): boolean {
  const updated = new Date(item.source_updated_at);
  if (Number.isNaN(updated.getTime()) || updated.getTime() > now.getTime() + 5 * 60_000) return false;
  const rule = item.freshness;
  if (rule.kind === "max_age") return now.getTime() - updated.getTime() <= rule.hours * 3_600_000;
  const today = ctDate(now);
  const cutoff = ctInstant(today, `${String(rule.by_hour_ct).padStart(2, "0")}:00`);
  if (now.getTime() >= cutoff.getTime()) return ctDate(updated) === today;
  // Before today's cutoff: an update from yesterday or today is still acceptable.
  const yesterday = ctDate(new Date(ctInstant(today).getTime() - 12 * 3_600_000));
  return ctDate(updated) === today || ctDate(updated) === yesterday;
}

export function buildToday(feeds: HubFeeds, now: Date): TodayView {
  const today = ctDate(now);

  // Calendar stands alone: a missing or broken daily write never hides it.
  let calendar: TodayView["calendar"];
  if (!feeds.calendar.ok) calendar = { state: { kind: "unavailable", reason: feeds.calendar.reason }, entries: [] };
  else {
    const entries = feeds.calendar.items
      .filter((e) => e.due_date === today)
      .sort((a, b) => (a.due_time ?? "99:99").localeCompare(b.due_time ?? "99:99"));
    calendar = { state: entries.length ? { kind: "ok" } : { kind: "empty" }, entries };
  }

  let next: TodayView["next"];
  if (!feeds.next.ok) next = { state: { kind: "unavailable", reason: feeds.next.reason }, items: [] };
  else if (feeds.next.written_for_date !== today) {
    // Yesterday's list is not today's list. Show none of it as current.
    next = { state: { kind: "not_updated", last_written_for: feeds.next.written_for_date }, items: [] };
  } else {
    const items = feeds.next.items.map((it) => ({ ...it, status_label: STATUS_LABEL[it.status] ?? "To do", fresh: isFresh(it, now) }));
    next = { state: items.length ? { kind: "ok" } : { kind: "empty" }, items };
  }

  let morning: MorningMessage | null = null;
  if (feeds.morning.ok) morning = feeds.morning.items.find((m) => m.for_date === today) ?? null;

  return { today, generated_at: now.toISOString(), morning, next, calendar };
}

/** Plain-language text for a non-ok section. */
export function stateMessage(state: SectionState, what: "list" | "calendar"): string {
  switch (state.kind) {
    case "ok":
      return "";
    case "empty":
      return what === "list" ? "Nothing on the list today." : "Nothing on the calendar today.";
    case "not_updated":
      return state.last_written_for
        ? `Today's list has not been written yet. The last list was for ${ctDayShort(ctInstant(state.last_written_for, "12:00"))}, so it is not shown.`
        : "Today's list has not been written yet.";
    case "unavailable":
      if (state.reason === "not_connected") return what === "list" ? "The list is not connected yet." : "The calendar is not connected yet.";
      if (state.reason === "bad_data") return `The ${what} sent something the hub could not read, so it is not shown.`;
      return `Could not reach the ${what} just now. Nothing shown here is a guess.`;
  }
}
