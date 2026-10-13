import { useCallback, useEffect, useMemo, useState } from "react";
import { editions, expand, labelFor, stories, storyById, towns } from "./content";
import { chicagoDate, pickEdition } from "./dates";
import { assembleStoryIds } from "./ranking";
import type { Edition, Story, Vote } from "./schema";
import type { SetupResult } from "./setupParse";
import type { Prefs, Question, QuestionOption } from "./questions";
import { applyVote, deckKey, defaultState, loadState, saveState, type DeckState, type LocalState } from "./storage";

export type Reader = ReturnType<typeof useReader>;

export function useReader() {
  const [state, setState] = useState<LocalState>(() => loadState());
  const today = chicagoDate();
  const manifest = pickEdition(editions, today);

  const commit = useCallback((updater: (s: LocalState) => LocalState) => {
    setState((prev) => {
      const next = updater(prev);
      saveState(next);
      return next;
    });
  }, []);

  // Picked areas (regions, counties, towns) expand to the towns they cover.
  // No areas is allowed: the reader gets statewide and national news.
  const readerTowns = useMemo(() => expand(state.prefs.areas), [state.prefs.areas]);
  const needsSetup = !state.prefs.setup || state.prefs.interests.length === 0;
  const { interests, likes, avoids, favoriteWriters } = state.prefs;
  const profile = useMemo(
    () => ({ towns: readerTowns, interests, likes, avoids, favoriteWriters }),
    [readerTowns, interests, likes, avoids, favoriteWriters],
  );
  const key = manifest && !needsSetup ? deckKey(manifest.id, readerTowns, state.prefs) : "";

  // The deck is assembled once per edition + town set, then frozen so it
  // never reshuffles under the reader's thumb. Votes affect the next assembly.
  const deck: DeckState | null = useMemo(() => {
    if (!manifest || needsSetup) return null;
    const existing = state.decks[key];
    const pool = manifest.candidateStoryIds.map((id) => storyById.get(id)).filter((s): s is Story => Boolean(s));
    const sig = poolSignature(pool);
    if (existing && keepDeck(existing, pool.length, sig) && existing.storyIds.every((id) => storyById.has(id))) return existing;
    const storyIds = assembleStoryIds(pool, profile, towns, Object.values(state.feedback));
    return { storyIds, index: 0, seen: [], frozenAt: new Date().toISOString(), poolSize: pool.length, poolSig: sig };
  }, [manifest, needsSetup, key, state.decks, profile, state.feedback]);

  // Persist a freshly assembled deck right away so a vote can't reshuffle it.
  useEffect(() => {
    if (!deck || !key || state.decks[key] === deck) return;
    commit((s) => {
      if (s.decks[key] === deck) return s;
      // Keep only decks for the current edition; older ones are no longer reachable.
      const editionPrefix = key.split("|")[0] + "|";
      const kept = Object.fromEntries(Object.entries(s.decks).filter(([k]) => k.startsWith(editionPrefix)));
      return { ...s, decks: { ...kept, [key]: deck } };
    });
  }, [deck, key, state.decks, commit]);

  // Every published story in today's edition, for the daily question.
  const pool = useMemo(
    () => (manifest ? manifest.candidateStoryIds.map((id) => storyById.get(id)).filter((s): s is Story => Boolean(s)) : []),
    [manifest],
  );

  const deckStories = useMemo(() => (deck ? deck.storyIds.map((id) => storyById.get(id)!).filter(Boolean) : []), [deck]);

  const edition: Edition | null =
    manifest && deck
      ? {
          id: manifest.id,
          date: manifest.date,
          label: state.prefs.areas.length ? labelFor(state.prefs.areas) : "Minnesota",
          storyIds: deck.storyIds,
          estimatedTotalReadMinutes: Math.round(deckStories.reduce((n, s) => n + s.estimatedReadMinutes, 0)),
          isDemo: manifest.isDemo,
        }
      : null;

  const writeDeck = useCallback(
    (patch: (d: DeckState) => DeckState) => {
      if (!deck) return;
      commit((s) => ({ ...s, decks: { ...s.decks, [key]: patch(s.decks[key] ?? deck) } }));
    },
    [commit, deck, key],
  );

  const goTo = useCallback(
    (index: number) => {
      writeDeck((d) => {
        const clamped = Math.max(0, Math.min(d.storyIds.length, index));
        const seen = new Set(d.seen);
        // Moving forward past a card marks it as moved through. Not "read".
        if (clamped > d.index) for (let i = d.index; i < clamped; i++) seen.add(d.storyIds[i]);
        return { ...d, index: clamped, seen: [...seen] };
      });
    },
    [writeDeck],
  );

  const vote = useCallback(
    (story: Story, v: Vote) => {
      if (!edition) return;
      commit((s) =>
        applyVote(
          s,
          { storyId: story.id, editionId: edition.id, writerId: story.writerId, topics: story.topics, towns: story.cities },
          v,
        ),
      );
    },
    [commit, edition],
  );

  return {
    state,
    today,
    edition,
    deck,
    deckStories,
    next: () => {
      if (!deck) return;
      if (state.notice) commit((s) => ({ ...s, notice: null }));
      goTo(deck.index + 1);
    },
    prev: () => deck && goTo(deck.index - 1),
    goTo,
    vote,
    voteFor: (storyId: string) => state.feedback[storyId]?.vote ?? null,
    markHintSeen: () => commit((s) => (s.hintSeen ? s : { ...s, hintSeen: true })),
    needsSetup,
    /** Save what the setup screen parsed, show the honest line, and start a fresh deck. */
    completeSetup: (text: string, result: SetupResult) =>
      commit((s) => ({
        ...s,
        prefs: { ...s.prefs, ...result.prefs, setup: { text, source: result.source, at: new Date().toISOString() } },
        notice: result.notice,
      })),
    dismissNotice: () => commit((s) => ({ ...s, notice: null })),
    pool,
    /**
     * Apply an answer to the daily question. Like votes, it shapes the next edition, not this one:
     * today's deck is carried over to the new settings so nothing reshuffles under the reader.
     */
    answerQuestion: (q: Question, opt: QuestionOption) =>
      commit((s) => {
        const before: Prefs = s.prefs;
        const nextPrefs = { ...s.prefs, ...opt.apply(before) };
        const decks = { ...s.decks };
        if (manifest && deck) decks[deckKey(manifest.id, expand(nextPrefs.areas), nextPrefs)] = s.decks[key] ?? deck;
        return { ...s, prefs: nextPrefs, decks, answers: { ...s.answers, [q.id]: { option: opt.id, date: today, note: opt.confirm } } };
      }),
    readerTowns,
    setAreas: (ids: string[]) => commit((s) => ({ ...s, prefs: { ...s.prefs, areas: ids } })),
    setPrefs: (patch: Partial<LocalState["prefs"]>) => commit((s) => ({ ...s, prefs: { ...s.prefs, ...patch } })),
    /** Rebuild the current deck with the latest votes and towns. */
    rebuildDeck: () =>
      commit((s) => {
        const decks = { ...s.decks };
        delete decks[key];
        return { ...s, decks };
      }),
    clearFeedback: () => commit((s) => ({ ...s, feedback: {} })),
    resetAll: () => commit(() => defaultState()),
    importState: (next: LocalState) => commit(() => next),
    /** Every published edition up to today, newest first. */
    pastEditions: editions.filter((e) => e.date <= today).sort((a, b) => b.date.localeCompare(a.date)),
    /** This reader's stories for any edition: the frozen deck if they read it, otherwise picked the same way. */
    storiesFor: (editionId: string): Story[] => {
      const m = editions.find((e) => e.id === editionId);
      if (!m) return [];
      const frozen = Object.entries(state.decks).find(([k]) => k.startsWith(`${editionId}|`))?.[1];
      const ids = frozen?.storyIds ?? assembleStoryIds(
        m.candidateStoryIds.map((id) => storyById.get(id)).filter((s): s is Story => Boolean(s)),
        profile,
        towns,
        Object.values(state.feedback),
      );
      return ids.map((id) => storyById.get(id)).filter((s): s is Story => Boolean(s));
    },
    allStories: stories,
  };
}

/**
 * A frozen deck is kept so stories never reshuffle under the reader's thumb. It is rebuilt when it is
 * empty, or when the edition gained stories after it was built and the reader hasn't started it yet.
 */
export function keepDeck(deck: DeckState, poolSize: number, poolSig?: string): boolean {
  if (!deck.storyIds.length) return false; // never keep an empty deck
  const started = deck.index > 0 || deck.seen.length > 0;
  if (started) return true; // never reshuffle once the reader is swiping
  if (poolSig !== undefined) return deck.poolSig === poolSig; // rebuild if the edition changed (or the deck predates fingerprints)
  if (deck.poolSize === undefined) return deck.storyIds.length >= 5; // decks saved before these fixes: keep only full ones
  return deck.poolSize >= poolSize;
}

/** Changes whenever an edition's stories are added, removed or re-tagged. */
export function poolSignature(pool: (Pick<Story, "id" | "tone" | "mustKnow"> & { feelGood?: boolean })[]): string {
  const text = pool.map((s) => `${s.id}:${s.tone}:${s.mustKnow ? 1 : 0}${s.feelGood ? ":fg" : ""}`).join("|");
  let h = 0;
  for (let i = 0; i < text.length; i++) h = (h * 31 + text.charCodeAt(i)) | 0;
  return `${pool.length}-${(h >>> 0).toString(36)}`;
}
