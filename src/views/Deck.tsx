import { useEffect, useRef, useState, type PointerEvent as RPointerEvent } from "react";
import { StoryImage } from "../components/StoryImage";
import { ChevronLeft, ChevronRight, ThumbDown, ThumbUp } from "../components/Icons";
import { ProgressSegments } from "../components/ProgressSegments";
import { TopBar } from "../components/TopBar";
import { formatEditionDate } from "../lib/dates";
import { href } from "../lib/router";
import type { Reader } from "../lib/useReader";
import { Complete } from "./Complete";

const SWIPE_THRESHOLD = 60;

export function Deck({ reader }: { reader: Reader }) {
  const { edition, deck, deckStories, today } = reader;
  const [dx, setDx] = useState(0);
  const drag = useRef<{ x: number; y: number; active: boolean; moved: boolean } | null>(null);
  const suppressClick = useRef(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLElement && /INPUT|TEXTAREA|SELECT/.test(e.target.tagName)) return;
      if (e.key === "ArrowRight") advance();
      if (e.key === "ArrowLeft") reader.prev();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

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
  const seenFlags = deck.storyIds.map((id) => deck.seen.includes(id));

  function advance() {
    reader.next();
    if (!reader.state.hintSeen) reader.markHintSeen();
  }

  if (total === 0) {
    return (
      <div className="screen">
        <TopBar dateLabel={dateLabel} sub={edition.label} />
        <main className="empty">
          <h1>A quiet day</h1>
          <p>There are no stories for {edition.label} in this edition yet. Check back after the next morning edition.</p>
          <a className="pill-link" href={href.settings()}>Change your places</a>
        </main>
      </div>
    );
  }

  if (deck.index >= total) {
    return (
      <div className="screen">
        <TopBar dateLabel={dateLabel} sub={edition.label} />
        <ProgressSegments total={total} index={deck.index} seen={seenFlags} />
        <Complete reader={reader} />
      </div>
    );
  }

  const story = deckStories[deck.index];
  const vote = reader.voteFor(story.id);

  const onPointerDown = (e: RPointerEvent) => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    drag.current = { x: e.clientX, y: e.clientY, active: false, moved: false };
  };
  const onPointerMove = (e: RPointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const mx = e.clientX - d.x;
    const my = e.clientY - d.y;
    if (!d.active) {
      if (Math.abs(mx) > 10 && Math.abs(mx) > Math.abs(my) * 1.2) {
        d.active = true;
        (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
      } else if (Math.abs(my) > 10) {
        drag.current = null; // vertical intent: leave scrolling alone
        return;
      } else return;
    }
    d.moved = true;
    setDx(mx);
  };
  const onPointerUp = () => {
    const d = drag.current;
    drag.current = null;
    if (d?.moved) {
      suppressClick.current = true;
      setTimeout(() => (suppressClick.current = false), 50);
      // Swipe is navigation only. It never records a vote.
      if (dx <= -SWIPE_THRESHOLD) advance();
      else if (dx >= SWIPE_THRESHOLD) reader.prev();
    }
    setDx(0);
  };

  return (
    <div className="screen deck-screen">
      <TopBar dateLabel={dateLabel} sub={edition.label} />
      <ProgressSegments total={total} index={deck.index} seen={seenFlags} />
      {reader.state.notice ? (
        <p className="setup-notice" role="status">
          <span>{reader.state.notice}</span>
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
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          aria-roledescription="story card"
          aria-label={`Story ${deck.index + 1} of ${total}`}
        >
          <div className="card-media">
            <StoryImage story={story} className="card-img" variant="card" />
            {story.isDemo ? <span className="chip">Demo story</span> : null}
            {!reader.state.hintSeen && deck.index === 0 ? (
              <p className="hint" role="note">Swipe for the next story</p>
            ) : null}
          </div>
          <a
            className="card-panel"
            href={href.story(story.slug)}
            onClick={(e) => {
              if (suppressClick.current) e.preventDefault();
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
