import type { Feedback, Story, Town } from "./schema";

/**
 * Edition assembly, kept deliberately simple and readable.
 *
 * 1. Geography decides eligibility. Taste never overrides it.
 *    local      -> only when the story's town is one of the reader's towns
 *    regional   -> the reader's town, or a reader town in the same region
 *    statewide  -> everyone
 * 2. Eligible stories get a base score from geography.
 * 3. Votes add a small, capped taste adjustment. A single story vote is
 *    a provisional nudge to that story's topics and writer together; we do
 *    NOT claim it measures topic and writer preferences separately.
 * 4. A light variety pass avoids the same writer twice in a row.
 * 5. If fewer stories qualify, the edition is shorter. Nothing is padded.
 */

export const MAX_STORIES = 8;

export const BASE_SCORE = {
  localMatch: 100,
  regionalMatch: 80,
  statewide: 70,
} as const;

/** Per-key cap on accumulated votes, and the points each unit is worth. */
export const TASTE_UNIT_CAP = 3;
export const TOPIC_POINTS_PER_UNIT = 2;
export const WRITER_POINTS_PER_UNIT = 1;
/** Total taste adjustment can never exceed this, so it can't outweigh geography tiers (gap >= 10). */
export const MAX_TASTE_ADJUSTMENT = 8;

export type Eligibility = { eligible: boolean; base: number; reason: string };

export function eligibility(story: Story, readerTowns: string[], towns: Town[]): Eligibility {
  const regionOf = new Map(towns.map((t) => [t.id, t.region]));
  const readerSet = new Set(readerTowns);
  const directMatch = story.cities.some((c) => readerSet.has(c));
  const readerRegions = new Set(readerTowns.map((t) => regionOf.get(t)).filter(Boolean));
  const regionMatch = story.cities.some((c) => readerRegions.has(regionOf.get(c)));

  switch (story.significance) {
    case "statewide":
      return { eligible: true, base: directMatch ? BASE_SCORE.localMatch : BASE_SCORE.statewide, reason: "statewide significance" };
    case "regional":
      if (directMatch) return { eligible: true, base: BASE_SCORE.localMatch, reason: "in your town" };
      if (regionMatch) return { eligible: true, base: BASE_SCORE.regionalMatch, reason: "in your region" };
      return { eligible: false, base: 0, reason: "regional story outside your regions" };
    case "local":
      if (directMatch) return { eligible: true, base: BASE_SCORE.localMatch, reason: "in your town" };
      return { eligible: false, base: 0, reason: "local story for another town" };
  }
}

export type Taste = { topics: Record<string, number>; writers: Record<string, number> };

function clamp(n: number, lo: number, hi: number) {
  return Math.min(hi, Math.max(lo, n));
}

/** Build provisional taste units from explicit votes only. Swipes and opens are never inputs. */
export function tasteFromFeedback(feedback: Feedback[]): Taste {
  const topics: Record<string, number> = {};
  const writers: Record<string, number> = {};
  for (const f of feedback) {
    if (!f.vote) continue;
    const delta = f.vote === "up" ? 1 : -1;
    for (const t of f.topics) topics[t] = clamp((topics[t] ?? 0) + delta, -TASTE_UNIT_CAP, TASTE_UNIT_CAP);
    writers[f.writerId] = clamp((writers[f.writerId] ?? 0) + delta, -TASTE_UNIT_CAP, TASTE_UNIT_CAP);
  }
  return { topics, writers };
}

export function tasteAdjustment(story: Story, taste: Taste): number {
  const topicUnits = story.topics.map((t) => taste.topics[t] ?? 0);
  const topicAvg = topicUnits.length ? topicUnits.reduce((a, b) => a + b, 0) / topicUnits.length : 0;
  const writerUnits = taste.writers[story.writerId] ?? 0;
  const raw = topicAvg * TOPIC_POINTS_PER_UNIT + writerUnits * WRITER_POINTS_PER_UNIT;
  return clamp(raw, -MAX_TASTE_ADJUSTMENT, MAX_TASTE_ADJUSTMENT);
}

export type Scored = { story: Story; score: number; base: number; taste: number; reason: string };

export function scoreStories(stories: Story[], readerTowns: string[], towns: Town[], taste: Taste): Scored[] {
  const out: Scored[] = [];
  for (const story of stories) {
    if (story.status === "draft") continue;
    const e = eligibility(story, readerTowns, towns);
    if (!e.eligible) continue;
    const t = tasteAdjustment(story, taste);
    out.push({ story, score: e.base + t, base: e.base, taste: t, reason: e.reason });
  }
  return out.sort(
    (a, b) => b.score - a.score || b.story.publishedAt.localeCompare(a.story.publishedAt) || a.story.id.localeCompare(b.story.id),
  );
}

/** Greedy pass: take the best remaining story whose writer differs from the previous one, if any. */
export function varyWriters(scored: Scored[]): Scored[] {
  const remaining = [...scored];
  const out: Scored[] = [];
  while (remaining.length) {
    const prev = out[out.length - 1]?.story.writerId;
    const idx = remaining.findIndex((s) => s.story.writerId !== prev);
    out.push(remaining.splice(idx === -1 ? 0 : idx, 1)[0]);
  }
  return out;
}

export function assembleStoryIds(
  stories: Story[],
  readerTowns: string[],
  towns: Town[],
  feedback: Feedback[],
  max = MAX_STORIES,
): string[] {
  const scored = scoreStories(stories, readerTowns, towns, tasteFromFeedback(feedback));
  return varyWriters(scored.slice(0, max)).map((s) => s.story.id);
}
