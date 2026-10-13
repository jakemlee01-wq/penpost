import { useMemo } from "react";
import { areas, interestCatalog, writers } from "../lib/content";
import { formatEditionDate, signOff } from "../lib/dates";
import { answeredToday, questionFor } from "../lib/questions";
import { feelGoodBonus } from "../lib/ranking";
import { href } from "../lib/router";
import type { CategoryId } from "../lib/schema";
import type { Reader } from "../lib/useReader";

const sectionNames = Object.fromEntries(interestCatalog.categories.map((c) => [c.id, c.name])) as Record<CategoryId, string>;

export function Complete({ reader }: { reader: Reader }) {
  const { edition, today, deckStories, pool, state } = reader;
  const question = useMemo(
    () => questionFor({ prefs: state.prefs, pool, deck: deckStories, areas, writers, sectionNames }, state.answers, today),
    [state.prefs, pool, deckStories, state.answers, today],
  );
  if (!edition) return null;
  const voted = deckStories.filter((s) => reader.voteFor(s.id)).length;
  const picks = deckStories.length - feelGoodBonus(deckStories);
  const thanks = answeredToday(state.answers, today);
  return (
    <main className="complete">
      <div className="complete-card">
        <div className="sun" aria-hidden="true" />
        <h1>That's the paper. You're caught up.</h1>
        <p className="complete-meta">
          {picks} {picks === 1 ? "story" : "stories"} for {edition.label}, {formatEditionDate(edition.date, "long")}.
        </p>
        <p className="complete-signoff">{signOff(edition.date, today)}</p>
        <div className="complete-actions">
          <a className="pill-link" href={href.today()}>Review today's stories</a>
        </div>
        {voted > 0 ? (
          <p className="complete-note">Your {voted === 1 ? "vote" : "votes"} will shape the next edition on this device, not this one.</p>
        ) : null}
      </div>
      {question ? (
        <section className="daily-q" aria-labelledby="daily-q-title">
          <p className="daily-q-kicker">One question for tomorrow</p>
          <h2 id="daily-q-title">{question.prompt}</h2>
          <div className="daily-q-options">
            {question.options.map((o) => (
              <button key={o.id} className="daily-q-option" onClick={() => reader.answerQuestion(question, o)}>
                {o.label}
              </button>
            ))}
          </div>
        </section>
      ) : thanks ? (
        <section className="daily-q done" role="status">
          <p className="daily-q-thanks">{thanks}</p>
          <a className="daily-q-link" href={href.settings()}>See your settings</a>
        </section>
      ) : null}
    </main>
  );
}
