import { formatEditionDate, signOff } from "../lib/dates";
import { href } from "../lib/router";
import type { Reader } from "../lib/useReader";

export function Complete({ reader }: { reader: Reader }) {
  const { edition, today, deckStories } = reader;
  if (!edition) return null;
  const voted = deckStories.filter((s) => reader.voteFor(s.id)).length;
  return (
    <main className="complete">
      <div className="complete-card">
        <div className="sun" aria-hidden="true" />
        <h1>That's the paper. You're caught up.</h1>
        <p className="complete-meta">
          {deckStories.length} {deckStories.length === 1 ? "story" : "stories"} for {edition.label}, {formatEditionDate(edition.date, "long")}.
        </p>
        <p className="complete-signoff">{signOff(edition.date, today)}</p>
        <div className="complete-actions">
          <a className="pill-link" href={href.today()}>Review today's stories</a>
          <button className="text-btn" onClick={() => reader.goTo(0)}>Back to the first card</button>
        </div>
        {voted > 0 ? (
          <p className="complete-note">Your {voted === 1 ? "vote" : "votes"} will shape the next edition on this device, not this one.</p>
        ) : null}
      </div>
    </main>
  );
}
