import { useEffect } from "react";
import { StoryBadge } from "../components/StoryBadge";
import { StoryImage } from "../components/StoryImage";
import { ChevronLeft, ChevronRight, ThumbDown, ThumbUp } from "../components/Icons";
import { ProgressSegments } from "../components/ProgressSegments";
import { TopBar } from "../components/TopBar";
import { formatEditionDate } from "../lib/dates";
import { feelGoodBonus } from "../lib/ranking";
import { href } from "../lib/router";
import type { Reader } from "../lib/useReader";
import { useSwipe } from "../lib/useSwipe";
import { Complete } from "./Complete";
import { Curating, PaperGate } from "./TodaysPaper";

export function Deck({ reader }: { reader: Reader }) {
  const { edition, deck, deckStories, today } = reader;
  // Swipe is navigation only. It never records a vote. It also works on the caught-up screen,
  // so a reader who finished can swipe right to get back to the last story.
  const swipe = useSwipe({ onLeft: () => advance(), onRight: () => reader.prev() });
  const { dx } = swipe;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLElement && /INPUT|TEXTAREA|SELECT/.test(e.target.tagName)) return;
      if (e.key === "ArrowRight") advance();
      if (e.key === "ArrowLeft") reader.prev();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  if (reader.curating) return <Curating reader={reader} />;
  if (reader.gated) return <PaperGate reader={reader} />;

  if (!edition || !deck) {
    return (
      <div className="screen">
        <TopBar dateLabel="No edition yet" />
        <main className="empty">
          <h1>No edition yet</h1>
          <p>There isn't a published edition to show. Penpost never fills the gap with made-up news.</p>
        </main>
      </div>
    );
  }

  const isToday = edition.date === today;
  const dateLabel = isToday ? formatEditionDate(edition.date) : `Latest: ${formatEditionDate(edition.date)}`;
  const total = deckStories.length;
  // Header shows what the reader is about to get; their places live in settings.
  // The feel-good bonus is the last card and isn't counted as one of the reader's stories.
  const bonus = feelGoodBonus(deckStories);
  const picks = total - bonus;
  const summary = total
    ? `${picks} ${picks === 1 ? "story" : "stories"}${bonus ? " + feel-good" : ""} · ${Math.max(1, edition.estimatedTotalReadMinutes)} min`
    : undefined;
  const seenFlags = deck.storyIds.map((id) => deck.seen.includes(id));

  function advance() {
    reader.next();
    if (!reader.state.hintSeen) reader.markHintSeen();
  }

  if (total === 0) {
    return (
      <div className="screen">
        <TopBar dateLabel={dateLabel} sub={summary} />
        <main className="empty">
          <h1>A quiet day</h1>
          <p>There are no stories for {edition.label} in this edition yet. Check back tomorrow.</p>
          <a className="pill-link" href={href.settings()}>Change your places</a>
        </main>
      </div>
    );
  }

  if (deck.index >= total) {
    return (
      <div className="screen">
        <TopBar dateLabel={dateLabel} sub={summary} />
        <ProgressSegments total={total} index={deck.index} seen={seenFlags} />
        <div
          className={`complete-swipe${dx ? " dragging" : ""}`}
          style={dx > 0 ? { transform: `translateX(${dx / 3}px)` } : undefined}
          {...swipe.handlers}
          // A swipe that ends over an answer button must not answer the question.
          onClickCapture={(e) => {
            if (swipe.wasSwipe()) {
              e.preventDefault();
              e.stopPropagation();
            }
          }}
        >
          <Complete reader={reader} />
        </div>
      </div>
    );
  }

  const story = deckStories[deck.index];
  const vote = reader.voteFor(story.id);

  return (
    <div className="screen deck-screen">
      <TopBar dateLabel={dateLabel} sub={summary} />
      <ProgressSegments total={total} index={deck.index} seen={seenFlags} />
      {reader.state.notice ? (
        <p className="setup-notice" role="status">
          <span>{reader.state.notice}</span>
          {reader.canRetryPaper ? (
            <button className="notice-retry" onClick={reader.askForPaper}>
              Try again
            </button>
          ) : null}
          <button className="notice-x" onClick={reader.dismissNotice} aria-label="Dismiss">
            ×
          </button>
        </p>
      ) : null}
      <main className="deck">
        <article
          key={story.id}
          className={`card${dx ? " dragging" : ""}`}
          style={dx ? { transform: `translateX(${dx}px) rotate(${dx / 60}deg)` } : undefined}
          {...swipe.handlers}
          aria-roledescription="story card"
          aria-label={`Story ${deck.index + 1} of ${total}`}
        >
          <div className="card-media">
            <StoryImage story={story} className="card-img" variant="card" />
            {story.isDemo ? <span className="chip">Demo story</span> : null}
            <StoryBadge story={story} />
            {!reader.state.hintSeen && deck.index === 0 ? (
              <p className="hint" role="note">Swipe for the next story</p>
            ) : null}
          </div>
          <a
            className="card-panel"
            href={href.story(story.slug)}
            onClick={(e) => {
              if (swipe.wasSwipe()) e.preventDefault();
            }}
            draggable={false}
          >
            <h1 className="card-headline">{story.headline}</h1>
            <p className="card-preview">{story.preview}</p>
            <span className="card-open">
              Read <ChevronRight />
            </span>
          </a>
        </article>
      </main>
      <footer className="controls">
        <button
          className={`vote vote-down${vote === "down" ? " on" : ""}`}
          aria-pressed={vote === "down"}
          aria-label={vote === "down" ? "Remove less like this" : "Less like this"}
          onClick={() => reader.vote(story, "down")}
        >
          <ThumbDown filled={vote === "down"} />
        </button>
        <div className="pager">
          <button className="nav-btn" onClick={() => reader.prev()} disabled={deck.index === 0} aria-label="Previous story">
            <ChevronLeft />
          </button>
          <span className="counter" aria-live="polite">
            {deck.index + 1} of {total}
          </span>
          <button className="nav-btn" onClick={advance} aria-label={deck.index === total - 1 ? "Finish edition" : "Next story"}>
            <ChevronRight />
          </button>
        </div>
        <button
          className={`vote vote-up${vote === "up" ? " on" : ""}`}
          aria-pressed={vote === "up"}
          aria-label={vote === "up" ? "Remove more like this" : "More like this"}
          onClick={() => reader.vote(story, "up")}
        >
          <ThumbUp filled={vote === "up"} />
        </button>
      </footer>
    </div>
  );
}
