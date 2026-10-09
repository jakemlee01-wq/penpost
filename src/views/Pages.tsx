import { useRef, useState } from "react";
import { Avatar } from "../components/Avatar";
import { ChevronLeft } from "../components/Icons";
import { AreaPicker } from "../components/AreaPicker";
import { normalizeAreaIds } from "../lib/areas";
import { TOPIC_LABELS, areas, writerById, writers } from "../lib/content";
import { formatEditionDate } from "../lib/dates";
import { tasteFromFeedback } from "../lib/ranking";
import { goBack, href } from "../lib/router";
import { sanitize, storageAvailable } from "../lib/storage";
import type { Reader } from "../lib/useReader";

function Bar({ title }: { title: string }) {
  return (
    <header className="article-bar">
      <button className="back-btn" onClick={() => goBack()} aria-label="Back">
        <ChevronLeft /> <span>Back</span>
      </button>
      <span className="bar-title">{title}</span>
    </header>
  );
}

export function Today({ reader }: { reader: Reader }) {
  const { edition, deckStories, deck } = reader;
  return (
    <div className="screen">
      <Bar title="Today's stories" />
      <main className="page">
        <h1>{edition ? formatEditionDate(edition.date, "long") : "Today"}</h1>
        {edition ? <p className="muted">{edition.label} · about {edition.estimatedTotalReadMinutes} minutes</p> : null}
        <ol className="story-list numbered">
          {deckStories.map((s, i) => {
            const w = writerById.get(s.writerId)!;
            const seen = deck?.seen.includes(s.id);
            return (
              <li key={s.id}>
                <a href={href.story(s.slug)}>
                  <span className="story-list-n">{i + 1}</span>
                  <span>
                    <span className="story-list-h">{s.headline}</span>
                    <span className="story-list-m">
                      {w.name} · {s.estimatedReadMinutes} min{seen ? " · passed" : ""}
                      {reader.voteFor(s.id) ? ` · ${reader.voteFor(s.id) === "up" ? "more like this" : "less like this"}` : ""}
                    </span>
                  </span>
                </a>
              </li>
            );
          })}
        </ol>
        {deckStories.length === 0 ? <p>No stories in this edition for your towns.</p> : null}
      </main>
    </div>
  );
}

export function Settings({ reader }: { reader: Reader }) {
  const { state } = reader;
  const [msg, setMsg] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  const [draft, setDraft] = useState<string[]>(state.prefs.areas);
  const changed = draft.join() !== state.prefs.areas.join();
  const taste = tasteFromFeedback(Object.values(state.feedback));
  const votes = Object.values(state.feedback).filter((f) => f.vote);

  const saveAreas = () => {
    if (!draft.length) {
      setMsg("Keep at least one place.");
      return;
    }
    reader.setAreas(draft);
    setMsg("Saved. Your edition now follows these places.");
  };

  const exportData = () => {
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "penpost-local-data.json";
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const importData = async (file: File) => {
    try {
      const next = sanitize(JSON.parse(await file.text()), (ids) => normalizeAreaIds(ids, areas));
      reader.importState(next);
      setDraft(next.prefs.areas);
      setMsg("Imported.");
    } catch {
      setMsg("That file couldn't be read.");
    }
  };

  const adj = [
    ...Object.entries(taste.topics).filter(([, v]) => v).map(([k, v]) => `${TOPIC_LABELS[k] ?? k} ${v > 0 ? "+" : ""}${v}`),
    ...Object.entries(taste.writers).filter(([, v]) => v).map(([k, v]) => `${writerById.get(k)?.name ?? k} ${v > 0 ? "+" : ""}${v}`),
  ];

  return (
    <div className="screen">
      <Bar title="Settings" />
      <main className="page">
        <h1>Your places</h1>
        <p className="muted">Your edition follows these places. Stories from elsewhere only appear when they matter statewide.</p>
        <AreaPicker value={draft} onChange={(ids) => { setDraft(ids); setMsg(""); }} />
        <div className="btn-row">
          <button className="pill-btn" onClick={saveAreas} disabled={!changed}>
            Save places
          </button>
        </div>
        {msg ? <p className="notice" role="status">{msg}</p> : null}

        <h2>Your votes</h2>
        <p className="muted">
          {votes.length} {votes.length === 1 ? "vote" : "votes"} saved. Votes gently reorder future editions. They never remove big stories or change facts.
        </p>
        {adj.length ? (
          <p className="fineprint">
            Current nudges (small, capped, and approximate, since a thumb on a story can't tell topic from tone): {adj.join(", ")}
          </p>
        ) : null}
        <div className="btn-row">
          <button className="pill-btn" onClick={() => { reader.rebuildDeck(); setMsg("Today's edition rebuilt with your latest towns and votes."); }}>
            Rebuild today's edition
          </button>
          <button className="pill-btn ghost" onClick={() => { reader.clearFeedback(); setMsg("Votes cleared."); }}>
            Clear votes
          </button>
        </div>

        <h2>Your data</h2>
        <p className="muted">
          Everything here is stored in this browser only. It does not sync across devices and is never sent anywhere.
          {storageAvailable() ? "" : " Storage is blocked in this browser, so settings last until you close the tab."}
        </p>
        <div className="btn-row">
          <button className="pill-btn ghost" onClick={exportData}>Export</button>
          <button className="pill-btn ghost" onClick={() => fileRef.current?.click()}>Import</button>
          <button className="pill-btn ghost danger" onClick={() => { reader.resetAll(); setDraft([]); setMsg("Everything reset. You'll pick your places again on the next visit."); }}>
            Reset everything
          </button>
          <input ref={fileRef} type="file" accept="application/json" hidden onChange={(e) => e.target.files?.[0] && importData(e.target.files[0])} />
        </div>
      </main>
    </div>
  );
}

export function About() {
  return (
    <div className="screen">
      <Bar title="About" />
      <main className="page">
        <h1>About Penpost</h1>
        <p>Minnesota business, in 10 minutes. A new edition every weekday, roughly eight short stories, and then it stops.</p>

        <h2>Written by AI</h2>
        <p>
          Every Penpost story is written by one of five AI writers. They are designed editorial personas with distinct voices, not real
          reporters. None of them conducts interviews or has firsthand knowledge. Every story links to its sources, and a human editor
          reviews each real edition before it is published.
        </p>
        <ul className="writer-grid">
          {writers.map((w) => (
            <li key={w.id}>
              <a href={href.writer(w.id)}>
                <Avatar writer={w} size={64} />
                <span className="writer-grid-name">{w.name}</span>
                <span className="writer-grid-tag">{w.tagline}</span>
              </a>
            </li>
          ))}
        </ul>

        <h2>How stories are sourced</h2>
        <p>
          Writers work from company announcements, public records, and other reporting, then write a fresh account. A company's claim is
          reported as a claim. When a story relies on another outlet's reporting, it says so. Source names, links, and dates appear at
          the end of each article.
        </p>
        <h2>How your edition is put together</h2>
        <p>
          Your edition follows your towns. Stories from other towns appear only when they are big enough to matter statewide. On a quiet
          day the edition is shorter. Your optional thumbs gently reorder future editions on this device. Swiping past a story is never
          counted as a vote.
        </p>
        <h2>This is an early version</h2>
        <p>
          Penpost is new and still being shaped. Story pictures are illustrations, not news photos. If something looks wrong, it gets
          corrected and the article says so.
        </p>
      </main>
    </div>
  );
}
