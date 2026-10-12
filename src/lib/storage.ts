import { CATEGORY_IDS, SCOPES, WRITER_IDS, type Feedback, type Interest, type ReaderPreferences, type SetupRecord, type Vote } from "./schema";
import { MAX_AVOIDS, MAX_LIKES, cleanPhrase } from "./setupParse";

/**
 * Everything the reader does is stored on this device only, under one key.
 * If storage is unavailable (private mode, blocked), we fall back to memory
 * so the app still works for the session.
 */

export const STORAGE_KEY = "penpost.v1";

export type DeckState = {
  storyIds: string[];
  index: number; // current card; storyIds.length means the completion screen
  seen: string[]; // stories the reader has moved through (not "read")
  frozenAt: string;
  /** How many candidate stories the edition had when this deck was built. */
  poolSize?: number;
};

export type LocalState = {
  version: 1;
  prefs: ReaderPreferences;
  feedback: Record<string, Feedback>;
  decks: Record<string, DeckState>;
  hintSeen: boolean;
  /** One honest line shown on the deck right after setup, until dismissed or the reader moves on. */
  notice: string | null;
};

export function defaultState(): LocalState {
  return {
    version: 1,
    prefs: { areas: [], interests: [], likes: [], avoids: [], favoriteWriters: [], setup: null },
    feedback: {},
    decks: {},
    hintSeen: false,
    notice: null,
  };
}

let memory: LocalState | null = null;
let normalizer: (ids: unknown) => string[] = defaultNormalize;

function defaultNormalize(ids: unknown): string[] {
  return Array.isArray(ids) ? ids.filter((x): x is string => typeof x === "string") : [];
}

/** The app registers the catalog-aware normalizer at startup. */
export function setAreaNormalizer(fn: (ids: unknown) => string[]) {
  normalizer = fn;
}

function safeStorage(): Storage | null {
  try {
    const s = window.localStorage;
    const probe = "__penpost_probe__";
    s.setItem(probe, "1");
    s.removeItem(probe);
    return s;
  } catch {
    return null;
  }
}

/**
 * Clean anything read from storage or an import file. `normalizeAreas` checks
 * area IDs against the catalog and upgrades older saves that stored plain town IDs.
 */
export function sanitize(value: unknown, normalizeAreas: (ids: unknown) => string[] = defaultNormalize): LocalState {
  const base = defaultState();
  if (!value || typeof value !== "object") return base;
  const v = value as Partial<LocalState> & { prefs?: { towns?: unknown } };
  const rawAreas = Array.isArray(v.prefs?.areas) ? v.prefs!.areas : v.prefs?.towns;
  const areas = normalizeAreas(rawAreas);
  const interests = sanitizeInterests(v.prefs?.interests);
  const avoids = phrases(v.prefs?.avoids, MAX_AVOIDS);
  return {
    version: 1,
    prefs: {
      areas,
      interests,
      likes: phrases(v.prefs?.likes, MAX_LIKES).filter((l) => !avoids.includes(l)),
      avoids,
      favoriteWriters: Array.isArray(v.prefs?.favoriteWriters)
        ? v.prefs!.favoriteWriters.filter((w): w is string => (WRITER_IDS as readonly string[]).includes(w as string))
        : [],
      // Saves from the old two-step setup count as set up, so returning readers aren't asked again.
      setup: sanitizeSetup(v.prefs?.setup) ?? (interests.length ? { text: "", source: "manual", at: "" } : null),
    },
    feedback: v.feedback && typeof v.feedback === "object" ? v.feedback : {},
    decks: v.decks && typeof v.decks === "object" ? v.decks : {},
    hintSeen: Boolean(v.hintSeen),
    notice: typeof v.notice === "string" && v.notice.length < 300 ? v.notice : null,
  };
}

function phrases(raw: unknown, max: number): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const x of raw) {
    const p = cleanPhrase(x);
    if (p && !out.includes(p) && out.length < max) out.push(p);
  }
  return out;
}

function sanitizeSetup(raw: unknown): SetupRecord | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Partial<SetupRecord>;
  const source = (["ai", "basic", "starter", "manual"] as const).find((x) => x === r.source);
  if (!source) return null;
  return { text: typeof r.text === "string" ? r.text.slice(0, 1200) : "", source, at: typeof r.at === "string" ? r.at : "" };
}

function sanitizeInterests(raw: unknown): Interest[] {
  if (!Array.isArray(raw)) return [];
  const out = new Map<string, Interest>();
  for (const x of raw) {
    const i = x as Partial<Interest>;
    if ((CATEGORY_IDS as readonly string[]).includes(i?.category as string) && (SCOPES as readonly string[]).includes(i?.scope as string)) {
      out.set(i.category!, { category: i.category!, scope: i.scope! });
    }
  }
  return [...out.values()];
}

export function loadState(): LocalState {
  if (memory) return memory;
  const s = safeStorage();
  if (s) {
    try {
      const raw = s.getItem(STORAGE_KEY);
      memory = raw ? sanitize(JSON.parse(raw), normalizer) : defaultState();
      return memory;
    } catch {
      /* fall through */
    }
  }
  memory = defaultState();
  return memory;
}

export function saveState(next: LocalState): void {
  memory = next;
  const s = safeStorage();
  if (!s) return;
  try {
    s.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    /* storage full or blocked: keep in memory */
  }
}

export function storageAvailable(): boolean {
  return safeStorage() !== null;
}

/** Test helper. */
export function _resetMemory() {
  memory = null;
}

/** A deck is frozen per edition and per reader setup; changing any setting builds a new one. */
export function deckKey(
  editionId: string,
  townIds: string[],
  prefs?: Pick<ReaderPreferences, "interests" | "likes" | "avoids" | "favoriteWriters">,
): string {
  const sorted = (xs: string[]) => [...xs].sort().join(",");
  const extra = prefs
    ? `|${sorted(prefs.interests.map((i) => `${i.category}:${i.scope}`))}|+${sorted(prefs.likes)}|-${sorted(prefs.avoids)}|${sorted(prefs.favoriteWriters)}`
    : "";
  return `${editionId}|${[...townIds].sort().join(",")}${extra}`;
}

/** Set, switch, or clear a vote. Passing the current vote again clears it. */
export function applyVote(state: LocalState, base: Omit<Feedback, "vote" | "votedAt">, vote: Vote, now = new Date()): LocalState {
  const existing = state.feedback[base.storyId];
  const nextVote: Vote | null = existing?.vote === vote ? null : vote;
  const feedback = { ...state.feedback };
  if (nextVote === null) {
    delete feedback[base.storyId];
  } else {
    feedback[base.storyId] = { ...base, vote: nextVote, votedAt: now.toISOString() };
  }
  return { ...state, feedback };
}
