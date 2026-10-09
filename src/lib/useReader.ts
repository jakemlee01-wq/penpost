import { useCallback, useEffect, useMemo, useState } from "react";
import { editions, expand, labelFor, stories, storyById, towns } from "./content";
import { chicagoDate, pickEdition } from "./dates";
import { assembleStoryIds } from "./ranking";
import type { Edition, Story, Vote } from "./schema";
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
  const readerTowns = useMemo(() => expand(state.prefs.areas), [state.prefs.areas]);
  const needsAreas = readerTowns.length === 0;
  const key = manifest && !needsAreas ? deckKey(manifest.id, readerTowns) : "";

  // The deck is assembled once per edition + town set, then frozen so it
  // never reshuffles under the reader's thumb. Votes affect the next assembly.
  const deck: DeckState | null = useMemo(() => {
    if (!manifest || needsAreas) return null;
    const existing = state.decks[key];
    if (existing && existing.storyIds.every((id) => storyById.has(id))) return existing;
    const pool = manifest.candidateStoryIds.map((id) => storyById.get(id)).filter((s): s is Story => Boolean(s));
    const storyIds = assembleStoryIds(pool, readerTowns, towns, Object.values(state.feedback));
    return { storyIds, index: 0, seen: [], frozenAt: new Date().toISOString() };
  }, [manifest, needsAreas, key, state.decks, readerTowns, state.feedback]);

  // Persist a freshly assembled deck right away so a vote can't reshuffle it.
  useEffect(() => {
    if (!deck || !key || state.decks[key]) return;
    commit((s) => {
      if (s.decks[key]) return s;
      // Keep only decks for the current edition; older ones are no longer reachable.
      const editionPrefix = key.split("|")[0] + "|";
      const kept = Object.fromEntries(Object.entries(s.decks).filter(([k]) => k.startsWith(editionPrefix)));
      return { ...s, decks: { ...kept, [key]: deck } };
    });
  }, [deck, key, state.decks, commit]);

  const deckStories = useMemo(() => (deck ? deck.storyIds.map((id) => storyById.get(id)!).filter(Boolean) : []), [deck]);

  const edition: Edition | null =
    manifest && deck
      ? {
          id: manifest.id,
          date: manifest.date,
          label: labelFor(state.prefs.areas),
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
    next: () => deck && goTo(deck.index + 1),
    prev: () => deck && goTo(deck.index - 1),
    goTo,
    vote,
    voteFor: (storyId: string) => state.feedback[storyId]?.vote ?? null,
    markHintSeen: () => commit((s) => (s.hintSeen ? s : { ...s, hintSeen: true })),
    needsAreas,
    readerTowns,
    setAreas: (ids: string[]) => commit((s) => ({ ...s, prefs: { ...s.prefs, areas: ids } })),
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
    allStories: stories,
  };
}
