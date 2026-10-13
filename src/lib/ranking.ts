import type { Feedback, Interest, Scope, Story, Town } from "./schema";
import { phraseMatches } from "./setupParse";

/**
 * Edition assembly, kept deliberately simple and readable.
 *
 * 1. Eligibility. A story qualifies when BOTH its place and its section fit the reader:
 *    place:   local/regional stories need one of the reader's towns (or, for regional, the
 *             same region). Statewide and national stories have no place requirement.
 *    section: one of the story's categories is an interest whose scope is wide enough.
 *             Scopes nest: "My places" < "Minnesota" < "National". Minnesota sports covers
 *             local and statewide sports; national economy covers local, state and national.
 *    Must-know stories (big news for the reader's places, or statewide must-knows) skip the
 *    section and tone checks, so nothing important gets filtered out.
 *    Sports narrows to the sports the reader named: someone who said "basketball and football"
 *    doesn't get a hockey game just because they turned sports on.
 *    A statewide story in one of the reader's sections ranks with stories from their own towns:
 *    a $100 million Minnesota expansion is local news to a reader who follows Minnesota business.
 *    A reader with no places gets statewide and national stories only.
 * 2. Tone. Editions lean lighter for everyone: a heavy story gets in only when it's must-know.
 * 3. Score = geography tier + small capped nudges (likes and dislikes from setup, votes,
 *    favorite writers, a one-point tie-break for light stories). Nudges can reorder stories within a tier but
 *    never move one across tiers. Dislikes are a nudge only, never a filter.
 * 4. Coverage: must-know stories go in first, then each section the reader turned on gets
 *    its best story (if it has one), then remaining slots go by score. So five slots can't
 *    all go to one section when the reader asked for several.
 * 5. Final order is by score, with a light pass so the same writer isn't twice in a row.
 * 6. Five stories. If fewer than five fit the reader's interests, the rest are filled with the
 *    best remaining stories for their places (statewide and national included), so no reader
 *    gets an empty edition while the day has stories. Heavy stories still need to be must-know.
 * 7. Feel-good bonus. Every reader gets one feel-good story a day as an extra last card, whatever
 *    their interests: the closest one to their places. If one of their five already is one, no bonus.
 */

export const MAX_STORIES = 5;

export const BASE_SCORE = {
  localMatch: 100,
  regionalMatch: 80,
  statewide: 70,
  national: 60,
} as const;

export const TASTE_UNIT_CAP = 3;
export const TOPIC_POINTS_PER_UNIT = 2;
export const WRITER_POINTS_PER_UNIT = 1;
export const FAVORITE_WRITER_POINTS = 3;
/** Free-form likes from setup: per matching phrase, capped. */
export const LIKE_POINTS = 3;
export const MAX_LIKE_POINTS = 6;
/** Explicit dislikes from setup: a down-weight inside the tier. Never removes a story. */
export const AVOID_POINTS = 6;
/** A tie-break only: a light story should never beat a more substantive one on tone alone. */
export const LIGHT_TONE_POINTS = 1;
/** Total of all nudges stays under the smallest gap between tiers (10). */
export const MAX_NUDGE = 9;
/** Kept for the taste-only cap used in Settings and tests. */
export const MAX_TASTE_ADJUSTMENT = 8;

const SCOPE_RANK: Record<Scope, number> = { local: 0, minnesota: 1, national: 2 };

export type ReaderProfile = {
  towns: string[];
  interests: Interest[];
  likes: string[];
  avoids: string[];
  favoriteWriters: string[];
};

export type Eligibility = { eligible: boolean; base: number; reason: string };

function clamp(n: number, lo: number, hi: number) {
  return Math.min(hi, Math.max(lo, n));
}

/** Where the story sits: 0 = needs a place match, 1 = statewide, 2 = national. */
function storyLevel(story: Story): number {
  if (story.significance === "national") return 2;
  if (story.significance === "statewide") return 1;
  return 0;
}

export function placeFit(story: Story, readerTowns: string[], towns: Town[]): Eligibility {
  const regionOf = new Map(towns.map((t) => [t.id, t.region]));
  const readerSet = new Set(readerTowns);
  const directMatch = story.cities.some((c) => readerSet.has(c));
  const readerRegions = new Set(readerTowns.map((t) => regionOf.get(t)).filter(Boolean));
  const regionMatch = story.cities.some((c) => readerRegions.has(regionOf.get(c)));

  switch (story.significance) {
    case "national":
      return { eligible: true, base: directMatch ? BASE_SCORE.localMatch : BASE_SCORE.national, reason: "national" };
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

/** Sports a reader can name in setup likes. Naming any of them narrows the sports section to those. */
export const SPORT_PHRASES = ["football", "basketball", "hockey", "baseball", "soccer", "golf", "volleyball", "wrestling", "softball", "tennis", "running", "fishing", "hunting"];

const TEAM_SPORTS: [RegExp, string][] = [
  [/\b(timberwolves|wolves|lynx)\b/, "basketball"],
  [/\b(minnesota wild|frost)\b/, "hockey"],
  [/\bvikings\b/, "football"],
  [/\b(minnesota twins|st\.? paul saints)\b/, "baseball"],
  [/\b(minnesota united|loons)\b/, "soccer"],
];

/** Sports the reader named anywhere in their likes: "Minnesota basketball" names basketball. */
export function namedSports(likes: string[]): string[] {
  // In the reader's own order, so "basketball and football" reads back the way they said it.
  const out: string[] = [];
  for (const l of likes) {
    const low = l.toLowerCase();
    for (const sport of SPORT_PHRASES) if (!out.includes(sport) && new RegExp(`\\b${sport}\\b`).test(low)) out.push(sport);
    // A team names its sport: a Wolves fan follows basketball, a Wild fan hockey.
    for (const [re, sport] of TEAM_SPORTS) if (!out.includes(sport) && re.test(low)) out.push(sport);
  }
  return out;
}

/** Does one of the story's sections match an interest wide enough to cover it? */
export function sectionFit(story: Story, interests: Interest[], likes: string[] = []): boolean {
  const level = storyLevel(story);
  const sports = namedSports(likes);
  return story.categories.some(
    (c) =>
      interests.some(
        (i) =>
          i.category === c &&
          SCOPE_RANK[i.scope] >= level &&
          // A focused national interest takes national stories only when they match the focus.
          (level < 2 || !i.focus?.length || i.focus.some((f) => phraseMatches(f, story))),
      ) &&
      (c !== "sports" || !sports.length || sports.some((sport) => phraseMatches(sport, story))),
  );
}

/**
 * Place AND section, with the must-know floor and the lighter-tone rule.
 * Without a profile's interests (older callers), only place is checked.
 * Likes and dislikes are deliberately absent here: they only nudge the score.
 */
export function eligibility(
  story: Story,
  readerTowns: string[],
  towns: Town[],
  profile?: Pick<ReaderProfile, "interests"> & Partial<Pick<ReaderProfile, "likes">>,
): Eligibility {
  const place = placeFit(story, readerTowns, towns);
  if (!place.eligible || !profile) return place;
  const mustKnow = story.mustKnow && story.significance !== "national";
  if (mustKnow) return { ...place, reason: `${place.reason}, must-know` };
  if (!sectionFit(story, profile.interests, profile.likes)) return { eligible: false, base: 0, reason: "not one of your interests" };
  if (story.tone === "heavy") return { eligible: false, base: 0, reason: "heavy story, not must-know" };
  if (story.significance === "statewide" && place.base < BASE_SCORE.localMatch) {
    return { eligible: true, base: BASE_SCORE.localMatch, reason: "statewide, in your sections" };
  }
  return place;
}

export type Taste = { topics: Record<string, number>; writers: Record<string, number> };

/** Provisional taste units from explicit votes only. Swipes and opens are never inputs. */
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
  return clamp(topicAvg * TOPIC_POINTS_PER_UNIT + writerUnits * WRITER_POINTS_PER_UNIT, -MAX_TASTE_ADJUSTMENT, MAX_TASTE_ADJUSTMENT);
}

export function toneAdjustment(story: Story): number {
  return story.tone === "light" ? LIGHT_TONE_POINTS : 0;
}

/** Likes add a little, dislikes take away a little. Neither can remove a story or cross a tier. */
export function preferenceAdjustment(story: Story, likes: string[], avoids: string[]): number {
  const liked = likes.filter((l) => phraseMatches(l, story)).length;
  const avoided = avoids.some((a) => phraseMatches(a, story));
  return Math.min(MAX_LIKE_POINTS, liked * LIKE_POINTS) - (avoided ? AVOID_POINTS : 0);
}

export type Scored = { story: Story; score: number; base: number; nudge: number; reason: string };

const DEFAULT_PROFILE_EXTRAS = { interests: [] as Interest[], likes: [] as string[], avoids: [] as string[], favoriteWriters: [] as string[] };

export function scoreStories(stories: Story[], profile: ReaderProfile | string[], towns: Town[], taste: Taste): Scored[] {
  // Accept a bare town list for place-only ranking (used by older tests and tools).
  const p: ReaderProfile = Array.isArray(profile) ? { towns: profile, ...DEFAULT_PROFILE_EXTRAS } : profile;
  const checkSections = !Array.isArray(profile);
  const out: Scored[] = [];
  for (const story of stories) {
    if (story.status === "draft") continue;
    const e = eligibility(story, p.towns, towns, checkSections ? p : undefined);
    if (!e.eligible) continue;
    const favorite = p.favoriteWriters.includes(story.writerId) ? FAVORITE_WRITER_POINTS : 0;
    const nudge = clamp(
      tasteAdjustment(story, taste) + favorite + (checkSections ? toneAdjustment(story) + preferenceAdjustment(story, p.likes, p.avoids) : 0),
      -MAX_NUDGE,
      MAX_NUDGE,
    );
    out.push({ story, score: e.base + nudge, base: e.base, nudge, reason: e.reason });
  }
  return out.sort(
    (a, b) =>
      b.score - a.score ||
      // On a tie, the reader's own towns come before statewide stories lifted into the local tier.
      Number(a.reason.startsWith("statewide, in your")) - Number(b.reason.startsWith("statewide, in your")) ||
      b.story.publishedAt.localeCompare(a.story.publishedAt) ||
      a.story.id.localeCompare(b.story.id),
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

/** Pick up to `max`: must-knows, then one per interest section, then best remaining. Returned in score order. */
export function selectWithCoverage(scored: Scored[], interests: Interest[], max: number): Scored[] {
  const picked: Scored[] = [];
  // Editions lean lighter: at most one heavy story per reader, and only when it is must-know.
  const take = (s: Scored | undefined) => {
    if (!s || picked.length >= max || picked.includes(s)) return;
    if (s.story.tone === "heavy" && picked.some((p) => p.story.tone === "heavy")) return;
    picked.push(s);
  };
  const firstMustKnow = scored.find((s) => s.story.mustKnow);
  take(firstMustKnow);
  for (const i of interests) take(scored.find((s) => !picked.includes(s) && s.story.categories.includes(i.category)));
  for (const s of scored) take(s);
  return scored.filter((s) => picked.includes(s));
}

export function assembleStoryIds(
  stories: Story[],
  profile: ReaderProfile | string[],
  towns: Town[],
  feedback: Feedback[],
  max = MAX_STORIES,
): string[] {
  const taste = tasteFromFeedback(feedback);
  const scored = scoreStories(stories, profile, towns, taste);
  const interests = Array.isArray(profile) ? [] : profile.interests;
  const picked = selectWithCoverage(scored, interests, max);
  if (picked.length < max && !Array.isArray(profile)) {
    // Fill: best remaining stories by place alone, still skipping heavy stories that aren't must-know.
    const chosen = new Set(picked.map((s) => s.story.id));
    const fill = scoreStories(stories, profile.towns, towns, taste)
      .filter((s) => !chosen.has(s.story.id) && s.story.tone !== "heavy")
      .map((s) => ({ ...s, score: s.score - FILL_PENALTY, reason: `${s.reason}, fill` }));
    picked.push(...fill.slice(0, max - picked.length));
  }
  const ids = varyWriters(picked.sort((a, b) => b.score - a.score)).map((s) => s.story.id);
  if (picked.some((s) => s.story.feelGood)) return ids;
  const readerTowns = Array.isArray(profile) ? profile : profile.towns;
  const bonus = pickFeelGood(stories.filter((s) => !ids.includes(s.id)), readerTowns, towns);
  return bonus ? [...ids, bonus.id] : ids;
}

/** The day's feel-good story for a reader: closest to their places first (any place qualifies), then lighter, then newest. */
export function pickFeelGood(stories: Story[], readerTowns: string[], towns: Town[]): Story | undefined {
  return stories
    .filter((s) => s.feelGood && s.status !== "draft" && s.tone !== "heavy")
    // Good news travels: a story from another town still qualifies, it just ranks below nearby ones.
    .map((s) => ({ s, fit: placeFit(s, readerTowns, towns) }))
    .sort(
      (a, b) =>
        b.fit.base - a.fit.base ||
        toneAdjustment(b.s) - toneAdjustment(a.s) ||
        b.s.publishedAt.localeCompare(a.s.publishedAt) ||
        a.s.id.localeCompare(b.s.id),
    )[0]?.s;
}

/** Fill stories always rank below stories that matched the reader's interests. */
export const FILL_PENALTY = 1000;

/** 1 when the last card is the feel-good bonus (not one of the reader's picks), else 0. */
export function feelGoodBonus(deck: Pick<Story, "feelGood">[]): 0 | 1 {
  return deck.length > 1 && deck[deck.length - 1].feelGood && deck.slice(0, -1).every((s) => !s.feelGood) ? 1 : 0;
}
