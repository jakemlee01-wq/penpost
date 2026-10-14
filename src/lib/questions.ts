import type { Areas } from "./areas";
import { namedSports } from "./ranking";
import { phraseMatches } from "./setupParse";
import type { CategoryId, Interest, ReaderPreferences, Story, Writer } from "./schema";

/**
 * One tailored multiple-choice question on the "You're caught up" screen, at most one a day.
 *
 * Personal, not generic: each question starts from something the reader told us (their likes,
 * their sports, their hometown) and, where it helps, a real headline from today's paper they
 * didn't get. Every answer maps to a concrete settings change (or a deliberate "keep it"), so the
 * question tunes tomorrow's paper rather than collecting survey data. Never asked twice.
 */

export type Prefs = Pick<ReaderPreferences, "areas" | "interests" | "likes" | "avoids" | "favoriteWriters">;
export type QuestionOption = { id: string; label: string; confirm: string; apply: (p: Prefs) => Prefs };
export type Question = {
  id: string;
  /** What we're building on, in the reader's terms: "You said you follow venture capital and private equity." */
  context: string;
  prompt: string;
  /** A real headline from today's paper that this answer would bring in. */
  example?: string;
  options: QuestionOption[];
};
export type Answers = Record<string, { option: string; date: string; note: string }>;

export type QuestionContext = {
  prefs: Prefs;
  /** What the reader typed at setup, if anything. */
  setupText?: string;
  /** Every published story in today's edition, not just the reader's cards. */
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
const quote = (s: Story) => `“${s.headline}”`;

/** Which section a free-form like belongs to. Unknown names (Warren Buffett) count toward business. */
const LIKE_SECTION: [RegExp, CategoryId][] = [
  [/\b(ai|artificial intelligence|tech|software|startups? tools?|apps?|gadgets?)\b/, "technology"],
  [/\b(real estate|housing|homes?)\b/, "real-estate"],
  [/\b(restaurants?|food|cooking|recipes?)\b/, "food"],
  [/\b(farm\w*|agricultur\w*|crops?)\b/, "agriculture"],
  [/\b(politic\w*|elections?)\b/, "politics"],
  [/\b(health|fitness|running)\b/, "health"],
  [/\b(arts?|music|theater|culture)\b/, "culture"],
  [/\b(econom\w*|inflation|jobs|rates)\b/, "economy"],
];
function likesFor(category: CategoryId, likes: string[]): string[] {
  const mine = likes.filter((l) => {
    if (namedSports([l]).length) return false;
    const hit = LIKE_SECTION.find(([re]) => re.test(l.toLowerCase()));
    return hit ? hit[1] === category : category === "business";
  });
  // Drop a generic like when a more specific one covers it: "investing" when there's "value investing".
  return mine.filter((l) => !mine.some((o) => o !== l && o.includes(l)));
}

/** The reader named some sports: offer the others, never one they said they don't want. */
function sportsQuestion(c: QuestionContext): Question | null {
  if (!c.prefs.interests.some((i) => i.category === "sports")) return null;
  const named = namedSports(c.prefs.likes);
  if (!named.length) return null;
  const avoided = namedSports(c.prefs.avoids);
  const others = ["hockey", "baseball", "golf", "volleyball", "soccer"].filter((s) => !named.includes(s) && !avoided.includes(s));
  if (!others.length) return null;
  const example = c.pool.find((s) => s.categories.includes("sports") && !c.deck.includes(s) && others.some((o) => phraseMatches(o, s)));
  const top = others.slice(0, 2);
  return {
    // One id for good: adding a sport changes `named`, and an id built from it would re-ask tomorrow.
    id: "sports-beyond",
    context: `You said you're a fan of Minnesota ${list(named)}.`,
    prompt: `Want other Minnesota sports too?`,
    example: example ? quote(example) : undefined,
    options: [
      { id: "keep", label: `Just ${list(named)}`, confirm: `Got it. Sports stays ${list(named)}.`, apply: keep },
      ...top.map((s) => ({ id: `add-${s}`, label: `Add ${s}`, confirm: `Got it. ${cap(s)} is in from tomorrow.`, apply: (p: Prefs) => addLikes(p, [s]) })),
      { id: "all", label: avoided.length ? `All except ${list(avoided)}` : "All Minnesota sports", confirm: "Got it. More Minnesota sports from tomorrow.", apply: (p: Prefs) => addLikes(p, others) },
    ],
  };
}

/**
 * A section they follow in Minnesota only, on a day the paper had national stories in it.
 * Built on their own likes: "You said you follow venture capital and private equity. Want national news on those?"
 */
function scopeQuestion(c: QuestionContext): Question | null {
  for (const i of c.prefs.interests) {
    if (i.category === "sports" || SCOPE_RANK[i.scope] >= SCOPE_RANK.national) continue;
    const missed = c.pool.filter((s) => s.significance === "national" && s.categories.includes(i.category) && !c.deck.includes(s));
    if (!missed.length) continue;
    const name = c.sectionNames[i.category].toLowerCase();
    const focus = likesFor(i.category, c.prefs.likes);
    if (!focus.length) {
      return {
        id: `scope-national:${i.category}`,
        context: `You follow ${name} in Minnesota.`,
        prompt: `Want national ${name} stories too?`,
        example: quote(missed[0]),
        options: [
          { id: "national", label: `Yes, add national ${name}`, confirm: `Got it. National ${name} is in from tomorrow.`, apply: (p) => setInterest(p, { category: i.category, scope: "national" }) },
          { id: "keep", label: "No, just Minnesota", confirm: `Got it. ${cap(name)} stays Minnesota only.`, apply: keep },
        ],
      };
    }
    const shown = focus.slice(0, 3);
    const onFocus = missed.find((s) => focus.some((f) => phraseMatches(f, s)));
    return {
      id: `scope-national:${i.category}`,
      context: `You said you follow ${list(shown)}.`,
      prompt: `Want national news on ${shown.length > 1 ? "those" : "that"}, not just Minnesota?`,
      example: onFocus ? quote(onFocus) : undefined,
      options: [
        {
          id: "focus",
          label: `Yes, national ${list(shown)}`,
          confirm: `Got it. National ${list(shown)} news is in from tomorrow.`,
          apply: (p) => setInterest(p, { category: i.category, scope: "national", focus }),
        },
        {
          id: "national",
          label: `Yes, all national ${name}`,
          confirm: `Got it. All national ${name} is in from tomorrow.`,
          apply: (p) => setInterest(p, { category: i.category, scope: "national" }),
        },
        { id: "keep", label: "No, just Minnesota", confirm: `Got it. ${cap(name)} stays Minnesota only.`, apply: keep },
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
    const saidFrom = c.setupText && new RegExp(`\\bfrom ${town.name}\\b`, "i").test(c.setupText);
    const school = c.setupText?.match(new RegExp(`\\b(${town.name}[- ][A-Z][a-z]+)\\s+(high school|school)`, "i"));
    return {
      id: `home-area:${town.id}`,
      context: saidFrom ? `You said you're from ${town.name}.` : `You picked ${town.name}.`,
      prompt: school
        ? `Want news from around ${town.name} too, like ${school[1]} High School and the rest of ${county.name}?`
        : `Want news from around ${town.name} too, not just the town?`,
      options: [
        { id: "county", label: `Add ${county.name}`, confirm: `Got it. ${county.name} is in from tomorrow.`, apply: add(`county:${county.id}`) },
        { id: "region", label: `Add ${region.name}`, confirm: `Got it. ${region.name} is in from tomorrow.`, apply: add(`region:${region.id}`) },
        { id: "keep", label: `Just ${town.name}`, confirm: `Got it. ${town.name} only.`, apply: keep },
      ],
    };
  }
  return null;
}

/** A section they don't follow that had at least two stories today, shown with one of them. */
function sectionQuestion(c: QuestionContext): Question | null {
  const followed = new Set(c.prefs.interests.map((i) => i.category));
  const counts = new Map<CategoryId, Story[]>();
  for (const s of c.pool) for (const cat of s.categories) if (!followed.has(cat)) counts.set(cat, [...(counts.get(cat) ?? []), s]);
  const liked = (cat: CategoryId) => likesFor(cat, c.prefs.likes).length;
  const [cat, stories] = [...counts.entries()].filter(([, ss]) => ss.length >= 2).sort((a, b) => liked(b[0]) - liked(a[0]) || b[1].length - a[1].length)[0] ?? [];
  if (!cat || !stories) return null;
  const name = c.sectionNames[cat].toLowerCase();
  return {
    id: `section:${cat}`,
    context: `Today's paper had ${stories.length} ${name} stories you didn't get.`,
    prompt: `Want ${name} in your paper?`,
    example: quote(stories[0]),
    options: [
      { id: "minnesota", label: "Yes, Minnesota", confirm: `Got it. Minnesota ${name} is in from tomorrow.`, apply: (p) => setInterest(p, { category: cat, scope: "minnesota" }) },
      { id: "national", label: "Yes, Minnesota and national", confirm: `Got it. ${cap(name)} is in from tomorrow.`, apply: (p) => setInterest(p, { category: cat, scope: "national" }) },
      { id: "no", label: "No thanks", confirm: `Got it. No ${name}.`, apply: keep },
    ],
  };
}

/** No favorite writer yet: ask whose writing they liked today, naming who they read. */
function writerQuestion(c: QuestionContext): Question | null {
  if (c.prefs.favoriteWriters.length) return null;
  const ids = [...new Set(c.deck.map((s) => s.writerId))];
  const ws = ids.map((id) => c.writers.find((w) => w.id === id)).filter((w): w is Writer => Boolean(w)).slice(0, 3);
  if (ws.length < 2) return null;
  return {
    id: "favorite-writer",
    context: `Today you read ${list(ws.map((w) => w.name))}.`,
    prompt: "Whose writing did you enjoy most?",
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
  // Older saved answers carry a suffix ("sports-beyond:basketball,football"); they count as the same question.
  const asked = (id: string) => Object.keys(answers).some((k) => k === id || k.startsWith(`${id}:`));
  for (const gen of GENERATORS) {
    const q = gen(c);
    if (q && !asked(q.id)) return q;
  }
  return null;
}

/** The thank-you line for today's answer, if they answered one. */
export function answeredToday(answers: Answers, today: string): string | null {
  return Object.values(answers).find((a) => a.date === today)?.note ?? null;
}
