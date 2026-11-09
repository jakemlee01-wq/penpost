/** All "today" decisions for the hub happen here, in America/Chicago, on the server. */
export const HUB_TZ = "America/Chicago";

const dateFmt = new Intl.DateTimeFormat("en-CA", { timeZone: HUB_TZ, year: "numeric", month: "2-digit", day: "2-digit" });
const offsetFmt = new Intl.DateTimeFormat("en-US", { timeZone: HUB_TZ, timeZoneName: "shortOffset" });
const timeFmt = new Intl.DateTimeFormat("en-US", { timeZone: HUB_TZ, hour: "numeric", minute: "2-digit" });
const dayFmt = new Intl.DateTimeFormat("en-US", { timeZone: HUB_TZ, weekday: "long", month: "short", day: "numeric" });
const shortDayFmt = new Intl.DateTimeFormat("en-US", { timeZone: HUB_TZ, weekday: "short", month: "short", day: "numeric" });

/** YYYY-MM-DD in Chicago for an instant. */
export function ctDate(at: Date): string {
  return dateFmt.format(at);
}

/** Minutes east of UTC in Chicago at an instant (-360 in winter, -300 in summer). */
export function ctOffsetMinutes(at: Date): number {
  const name = offsetFmt.formatToParts(at).find((p) => p.type === "timeZoneName")?.value ?? "GMT-6";
  const m = /GMT([+-])(\d{1,2})(?::(\d{2}))?/.exec(name);
  if (!m) return 0;
  const mins = Number(m[2]) * 60 + Number(m[3] ?? 0);
  return m[1] === "-" ? -mins : mins;
}

/** The instant for a Chicago wall-clock date and "HH:MM". */
export function ctInstant(date: string, hhmm = "00:00"): Date {
  const [y, mo, d] = date.split("-").map(Number);
  const [h, mi] = hhmm.split(":").map(Number);
  const wall = Date.UTC(y, mo - 1, d, h, mi);
  let at = new Date(wall - ctOffsetMinutes(new Date(wall)) * 60_000);
  // Second pass settles dates that straddle a daylight saving change.
  at = new Date(wall - ctOffsetMinutes(at) * 60_000);
  return at;
}

export function ctTime(at: Date): string {
  return timeFmt.format(at);
}

export function ctDayLong(at: Date): string {
  return dayFmt.format(at);
}

export function ctDayShort(at: Date): string {
  return shortDayFmt.format(at);
}

/** "9:00 AM" from a calendar "HH:MM[:SS]" string, read as Chicago wall time. */
export function wallTimeLabel(hhmm: string | null | undefined): string {
  if (!hhmm) return "Anytime";
  const m = /^(\d{1,2}):(\d{2})/.exec(hhmm);
  if (!m) return "Anytime";
  const h = Number(m[1]);
  const suffix = h >= 12 ? "PM" : "AM";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${m[2]} ${suffix}`;
}
