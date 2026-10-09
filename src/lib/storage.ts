import type { Feedback, ReaderPreferences, Vote } from "./schema";

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
};

export type LocalState = {
  version: 1;
  prefs: ReaderPreferences;
  feedback: Record<string, Feedback>;
  decks: Record<string, DeckState>;
  hintSeen: boolean;
};

export function defaultState(): LocalState {
  return {
    version: 1,
    prefs: { areas: [], explicitTopics: [], explicitWriters: [] },
    feedback: {},
    decks: {},
    hintSeen: false,
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
  return {
    version: 1,
    prefs: {
      areas: normalizeAreas(rawAreas),
      explicitTopics: Array.isArray(v.prefs?.explicitTopics) ? v.prefs!.explicitTopics : [],
      explicitWriters: Array.isArray(v.prefs?.explicitWriters) ? v.prefs!.explicitWriters : [],
    },
    feedback: v.feedback && typeof v.feedback === "object" ? v.feedback : {},
    decks: v.decks && typeof v.decks === "object" ? v.decks : {},
    hintSeen: Boolean(v.hintSeen),
  };
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

export function deckKey(editionId: string, townIds: string[]): string {
  return `${editionId}|${[...townIds].sort().join(",")}`;
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
