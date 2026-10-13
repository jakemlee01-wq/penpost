import type { Areas } from "./areas";
import { SPORT_PHRASES } from "./ranking";
import type { CategoryId, Interest, ReaderPreferences, Story, Writer } from "./schema";

/**
 * One tailored multiple-choice question on the "You're caught up" screen, at most one a day.
 * Every answer maps to a concrete change in the reader's settings (or a deliberate "keep it"),
 * so the question is never a survey: it tunes tomorrow's paper. A question is never asked twice.
 */

export type Prefs = Pick<ReaderPreferences, "areas" | "interests" | "likes" | "avoids" | "favoriteWriters">;
export type QuestionOption = { id: string; label: string; confirm: string; apply: (p: Prefs) => Prefs };
export type Question = { id: string; prompt: string; options: QuestionOption[] };
export type Answers = Record<string, { option: string; date: string; note: string }>;

export type QuestionContext = {
  prefs: Prefs;
  /** Every published story in today's edition, not just the reader's five. */
  pool: Story[];
  /** The reader's own cards today. */
  deck: Story[];
  areas: Areas;
  writers: Writer[];
  sectionNames: Record<CategoryId, string>;
};

const SCOPE_RANK = { local: 0, minnesota: 1, national: 2 } as const;
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const list = (xs: string[]) => (xs.length <= 1 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`);
const keep: QuestionOption["apply"] = (p) => p;
const addLikes = (p: Prefs, add: string[]) => ({ ...p, likes: [...p.likes, ...add.filter((a) => !p.likes.includes(a))] });
const setInterest = (p: Prefs, i: Interest) => ({ ...p, interests: [...p.interests.filter((x) => x.category !== i.category), i] });

/** Sports narrowed to the ones they named: offer the others. */
function sportsQuestion(c: QuestionContext): Question | null {
  if (!c.prefs.interests.some((i) => i.category === "sports")) return null;
  const named = c.prefs.likes.filter((l) => SPORT_PHRASES.includes(l));
  if (!named.length) return null;
  const others = ["hockey", "baseball", "golf", "soccer", "volleyball"].filter((s) => !named.includes(s) && !c.prefs.avoids.includes(s));
  if (!others.length) return null;
  const top = others.slice(0, 2);
  return {
    id: `sports-beyond:${[...named].sort().join(",")}`,
    prompt: `Want Minnesota sports beyond ${list(named)}?`,
    options: [
      { id: "keep", label: `Just ${list(named)}`, confirm: `Got it. Sports stays ${list(named)}.`, apply: keep },
      ...top.map((s) => ({ id: `add-${s}`, label: `Add ${s}`, confirm: `Got it. ${cap(s)} is in from tomorrow.`, apply: (p: Prefs) => addLikes(p, [s]) })),
      { id: "all", label: "All Minnesota sports", confirm: "Got it. All Minnesota sports from tomorrow.", apply: (p: Prefs) => addLikes(p, others) },
    ],
  };
}

/** A section they follow at Minnesota scope, on a day the paper had national stories in it. */
function scopeQuestion(c: QuestionContext): Question | null {
  for (const i of c.prefs.interests) {
    if (i.category === "sports" || SCOPE_RANK[i.scope] >= SCOPE_RANK.national) continue;
    const national = c.pool.filter((s) => s.significance === "national" && s.categories.includes(i.category));
    if (!national.length) continue;
    const name = c.sectionNames[i.category].toLowerCase();
    return {
      id: `scope-national:${i.category}`,
      prompt: `Do you want national ${name} news too, or just Minnesota?`,
      options: [
        { id: "keep", label: "Just Minnesota", confirm: `Got it. ${cap(name)} stays Minnesota only.`, apply: keep },
        { id: "national", label: `Add national ${name}`, confirm: `Got it. National ${name} is in from tomorrow.`, apply: (p) => setInterest(p, { category: i.category, scope: "national" }) },
      ],
    };
  }
  return null;
}

/** A single town picked without its surroundings: offer its county and region. */
function homeAreaQuestion(c: QuestionContext): Question | null {
  for (const id of c.prefs.areas) {
    if (!id.startsWith("town:")) continue;
    const town = c.areas.towns.find((t) => `town:${t.id}` === id);
    const county = town && c.areas.counties.find((x) => x.id === town.county);
    const region = county && c.areas.regions.find((r) => r.id === county.region);
    if (!town || !county || !region) continue;
    if (c.prefs.areas.includes(`county:${county.id}`) || c.prefs.areas.includes(`region:${region.id}`)) continue;
    const add = (area: string) => (p: Prefs) => ({ ...p, areas: p.areas.includes(area) ? p.areas : [...p.areas, area] });
    return {
      id: `home-area:${town.id}`,
      prompt: `Want news from around ${town.name} too, not just the town?`,
      options: [
        { id: "keep", label: `Just ${town.name}`, confirm: `Got it. ${town.name} only.`, apply: keep },
        { id: "county", label: `Add ${county.name}`, confirm: `Got it. ${county.name} is in from tomorrow.`, apply: add(`county:${county.id}`) },
        { id: "region", label: `Add ${region.name}`, confirm: `Got it. ${region.name} is in from tomorrow.`, apply: add(`region:${region.id}`) },
      ],
    };
  }
  return null;
}

/** A section they don't follow that had at least two stories today. */
function sectionQuestion(c: QuestionContext): Question | null {
  const followed = new Set(c.prefs.interests.map((i) => i.category));
  const counts = new Map<CategoryId, number>();
  for (const s of c.pool) for (const cat of s.categories) if (!followed.has(cat)) counts.set(cat, (counts.get(cat) ?? 0) + 1);
  const [cat, n] = [...counts.entries()].sort((a, b) => b[1] - a[1])[0] ?? [];
  if (!cat || !n || n < 2) return null;
  const name = c.sectionNames[cat].toLowerCase();
  return {
    id: `section:${cat}`,
    prompt: `Want ${name} news in your paper?`,
    options: [
      { id: "no", label: "No thanks", confirm: `Got it. No ${name}.`, apply: keep },
      { id: "minnesota", label: "Yes, Minnesota", confirm: `Got it. Minnesota ${name} is in from tomorrow.`, apply: (p) => setInterest(p, { category: cat, scope: "minnesota" }) },
      { id: "national", label: "Yes, Minnesota and national", confirm: `Got it. ${cap(name)} is in from tomorrow.`, apply: (p) => setInterest(p, { category: cat, scope: "national" }) },
    ],
  };
}

/** No favorite writer yet: ask whose writing they liked today. */
function writerQuestion(c: QuestionContext): Question | null {
  if (c.prefs.favoriteWriters.length) return null;
  const ids = [...new Set(c.deck.map((s) => s.writerId))];
  const ws = ids.map((id) => c.writers.find((w) => w.id === id)).filter((w): w is Writer => Boolean(w)).slice(0, 3);
  if (ws.length < 2) return null;
  return {
    id: "favorite-writer",
    prompt: "Whose writing did you enjoy most today?",
    options: [
      ...ws.map((w) => ({
        id: w.id,
        label: w.name,
        confirm: `Got it. You'll see a little more from ${w.name}.`,
        apply: (p: Prefs) => ({ ...p, favoriteWriters: [...p.favoriteWriters, w.id] }),
      })),
      { id: "none", label: "No favorite yet", confirm: "Got it.", apply: keep },
    ],
  };
}

const GENERATORS = [sportsQuestion, scopeQuestion, homeAreaQuestion, sectionQuestion, writerQuestion];

/** Today's question: the first useful one the reader hasn't answered. Null once they've answered one today. */
export function questionFor(c: QuestionContext, answers: Answers, today: string): Question | null {
  if (Object.values(answers).some((a) => a.date === today)) return null;
  for (const gen of GENERATORS) {
    const q = gen(c);
    if (q && !answers[q.id]) return q;
  }
  return null;
}

/** The thank-you line for today's answer, if they answered one. */
export function answeredToday(answers: Answers, today: string): string | null {
  return Object.values(answers).find((a) => a.date === today)?.note ?? null;
}
