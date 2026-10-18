import { expandAreas, type Areas } from "./areas";
import { CATEGORY_IDS, type CategoryId, type ReaderPreferences } from "./schema";

/**
 * Research topic IDs, shared by the drafting job (pipeline/agent.ts), the Worker's /curate
 * endpoint and the app. Keeping them in one place means the three can't drift apart.
 *
 *   local-<region>   one per region (any subject)
 *   mn-<category>    Minnesota news in one section
 *   us-<category>    U.S. national news in one section
 *   mn-feel-good, us-feel-good
 */

export const TOPIC_ID_PATTERN = /^(local|mn|us)-[a-z0-9-]+$/;
export const MAX_CURATE_TOPICS = 20;

export const localTopicId = (region: string) => `local-${region}`;
export const mnTopicId = (category: CategoryId | "feel-good") => `mn-${category}`;
export const usTopicId = (category: CategoryId | "feel-good") => `us-${category}`;

/** Every topic the drafting job knows, in the order it researches them (local first). */
export function allTopicIds(regions: { id: string }[]): string[] {
  return [
    ...regions.map((r) => localTopicId(r.id)),
    ...CATEGORY_IDS.map(mnTopicId),
    ...CATEGORY_IDS.map(usTopicId),
    mnTopicId("feel-good"),
    usTopicId("feel-good"),
  ];
}

/**
 * The topics one reader's paper needs, from their saved settings.
 *   - Picked towns roll up to their regions: one local-<region> per region with a picked town.
 *   - Minnesota sections: mn-<category>.
 *   - National sections: us-<category>, plus mn-<category>, because scopes nest (a national
 *     section also covers Minnesota stories in ranking.ts).
 *   - "My places" sections are covered by the local topics.
 *   - mn-feel-good always; us-feel-good only with a national section.
 *   - No sections and no places (the starter default): Minnesota business.
 */
export function readerTopicIds(prefs: Pick<ReaderPreferences, "areas" | "interests">, areas: Areas): string[] {
  const regionOf = new Map(areas.counties.map((c) => [c.id, c.region]));
  const countyOf = new Map(areas.towns.map((t) => [t.id, t.county]));
  const regions = new Set<string>();
  for (const town of expandAreas(prefs.areas, areas)) {
    const region = regionOf.get(countyOf.get(town) ?? "");
    if (region) regions.add(region);
  }
  const out = new Set<string>();
  // Region order from the catalog, so the list is stable for the same settings.
  for (const r of areas.regions) if (regions.has(r.id)) out.add(localTopicId(r.id));

  const interests = prefs.interests.filter((i) => (CATEGORY_IDS as readonly string[]).includes(i.category));
  let national = false;
  let sections = 0;
  for (const c of CATEGORY_IDS) {
    const i = interests.find((x) => x.category === c);
    if (!i) continue;
    if (i.scope === "minnesota" || i.scope === "national") {
      out.add(mnTopicId(c));
      sections++;
    }
    if (i.scope === "national") {
      out.add(usTopicId(c));
      national = true;
    }
  }
  // Nothing to research beyond feel-good (no sections, or only "My places" with no places): the starter default.
  if (!sections && !regions.size) out.add(mnTopicId("business"));
  out.add(mnTopicId("feel-good"));
  if (national) out.add(usTopicId("feel-good"));
  return [...out].slice(0, MAX_CURATE_TOPICS);
}

/** Valid YYYY-MM-DD that is a real calendar date. */
export function isRealDate(date: unknown): date is string {
  if (typeof date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  const d = new Date(`${date}T12:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === date;
}

/** Saturday or Sunday, for a YYYY-MM-DD calendar date. */
export function isWeekend(date: string): boolean {
  const day = new Date(`${date}T12:00:00Z`).getUTCDay();
  return day === 0 || day === 6;
}

// ---------------------------------------------------------------------------
// The per-day topic manifest, content/topics/<date>.json: the shared cache and dedupe.

export type TopicStatus = "pending" | "ready" | "failed";
export type TopicEntry = {
  status: TopicStatus;
  startedAt?: string;
  finishedAt?: string;
  /** Published stories this topic added to the edition. */
  storiesWritten?: number;
  /** Search and model calls spent on this topic. */
  modelCalls?: number;
  error?: string;
};
export type TopicManifest = { date: string; topics: Record<string, TopicEntry> };

export function emptyManifest(date: string): TopicManifest {
  return { date, topics: {} };
}

/** Read a manifest from JSON text, dropping anything malformed. */
export function parseManifest(text: string | null | undefined, date: string): TopicManifest {
  if (!text) return emptyManifest(date);
  try {
    const raw = JSON.parse(text) as { topics?: Record<string, Partial<TopicEntry>> };
    const topics: Record<string, TopicEntry> = {};
    for (const [id, e] of Object.entries(raw?.topics ?? {})) {
      if (!TOPIC_ID_PATTERN.test(id) || !e || !["pending", "ready", "failed"].includes(e.status as string)) continue;
      topics[id] = e as TopicEntry;
    }
    return { date, topics };
  } catch {
    return emptyManifest(date);
  }
}

export function serializeManifest(m: TopicManifest): string {
  const topics = Object.fromEntries(Object.entries(m.topics).sort(([a], [b]) => a.localeCompare(b)));
  return JSON.stringify({ date: m.date, topics }, null, 2) + "\n";
}

/** Mark requested topics pending, skipping any already ready. Returns the topics now claimed. */
export function claimTopics(m: TopicManifest, requested: string[], now: string): { manifest: TopicManifest; claimed: string[] } {
  const topics = { ...m.topics };
  const claimed: string[] = [];
  for (const id of new Set(requested)) {
    if (topics[id]?.status === "ready") continue;
    topics[id] = { status: "pending", startedAt: now };
    claimed.push(id);
  }
  return { manifest: { ...m, topics }, claimed };
}

/**
 * What a drafting run should cover: what it was asked for plus anything still pending from a run
 * that never got to write (a queued run GitHub replaced), minus everything already ready.
 */
export function planTopics(m: TopicManifest, requested: string[]): string[] {
  const pending = Object.entries(m.topics).filter(([, e]) => e.status === "pending").map(([id]) => id);
  return [...new Set([...requested, ...pending])].filter((id) => m.topics[id]?.status !== "ready");
}

export type TopicResult = { status: "ready" | "failed"; storiesWritten: number; modelCalls: number; error?: string };

/** Record a run's results. Topics it didn't report on keep their current entry. */
export function finishTopics(m: TopicManifest, results: Record<string, TopicResult>, now: string): TopicManifest {
  const topics = { ...m.topics };
  for (const [id, r] of Object.entries(results)) {
    if (!TOPIC_ID_PATTERN.test(id)) continue;
    const startedAt = topics[id]?.startedAt;
    topics[id] = {
      status: r.status,
      ...(startedAt ? { startedAt } : {}),
      finishedAt: now,
      storiesWritten: r.storiesWritten,
      modelCalls: r.modelCalls,
      ...(r.error ? { error: r.error.slice(0, 200) } : {}),
    };
  }
  return { ...m, topics };
}

// ---------------------------------------------------------------------------
// Lines for the curating screen, built from the reader's own topics. They say what the job does
// for each topic, never how far along it is.

const SECTION_WORDS: Record<CategoryId, string> = {
  business: "business",
  economy: "the economy",
  agriculture: "farming",
  technology: "startups and tech",
  sports: "sports",
  politics: "politics",
  health: "health care",
  "real-estate": "housing",
  food: "restaurants",
  culture: "arts and culture",
};

export function curatingLines(topics: string[], regions: { id: string; name: string }[]): string[] {
  const lines: string[] = [];
  for (const id of topics) {
    if (id.startsWith("local-")) {
      const name = regions.find((r) => localTopicId(r.id) === id)?.name;
      if (name) lines.push(`Checking what's happening in ${name.startsWith("Twin Cities") ? "the Twin Cities" : name}.`);
      continue;
    }
    const [scope, ...rest] = id.split("-");
    const what = rest.join("-");
    if (what === "feel-good") {
      lines.push(scope === "us" ? "Looking for good news from around the country." : "Looking for some good news close to home.");
      continue;
    }
    const words = SECTION_WORDS[what as CategoryId];
    if (!words) continue;
    lines.push(scope === "us" ? `Scanning national news on ${words}.` : `Reading up on Minnesota ${words === "the economy" ? "economy" : words}.`);
  }
  lines.push("Checking every story against its sources.");
  return lines;
}
