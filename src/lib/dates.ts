export const EDITORIAL_TZ = "America/Chicago";

/** YYYY-MM-DD for the given instant in America/Chicago. */
export function chicagoDate(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: EDITORIAL_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

/** Parse a YYYY-MM-DD as a calendar date (noon UTC avoids DST and offset edge cases). */
function calendar(date: string): Date {
  return new Date(`${date}T12:00:00Z`);
}

export function weekday(date: string): number {
  return calendar(date).getUTCDay();
}

export function formatEditionDate(date: string, style: "short" | "long" = "short"): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    weekday: style === "long" ? "long" : "short",
    month: style === "long" ? "long" : "short",
    day: "numeric",
    ...(style === "long" ? { year: "numeric" } : {}),
  }).format(calendar(date));
}

export function formatSourceDate(date: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(calendar(date));
}

/** Pick the latest edition dated on or before today. Never invents a new one. */
export function pickEdition<T extends { date: string }>(editions: T[], today: string): T | undefined {
  const eligible = editions.filter((e) => e.date <= today).sort((a, b) => b.date.localeCompare(a.date));
  if (eligible.length) return eligible[0];
  return [...editions].sort((a, b) => a.date.localeCompare(b.date))[0];
}

/** Closing line for the completion screen, based on the edition date and today. */
export function signOff(editionDate: string, today: string): string {
  const editionDay = weekday(editionDate);
  const todayDay = weekday(today);
  if (todayDay === 0 || todayDay === 6 || editionDay === 5) return "See you Monday.";
  return "See you tomorrow.";
}
