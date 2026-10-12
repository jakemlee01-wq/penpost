import { useRef, useState } from "react";
import { Avatar } from "../components/Avatar";
import { ChevronLeft } from "../components/Icons";
import { AreaPicker } from "../components/AreaPicker";
import { InterestPicker, TopicChips, WriterPicker } from "../components/InterestPicker";
import type { Interest } from "../lib/schema";
import { MAX_AVOIDS, MAX_LIKES } from "../lib/setupParse";
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
  const [interests, setInterests] = useState<Interest[]>(state.prefs.interests);
  const [likes, setLikes] = useState<string[]>(state.prefs.likes);
  const [avoids, setAvoids] = useState<string[]>(state.prefs.avoids);
  const [favorites, setFavorites] = useState<string[]>(state.prefs.favoriteWriters);
  const sig = (i: Interest[]) => i.map((x) => `${x.category}:${x.scope}`).sort().join();
  const same = (a: string[], b: string[]) => [...a].sort().join() === [...b].sort().join();
  const changed =
    draft.join() !== state.prefs.areas.join() ||
    sig(interests) !== sig(state.prefs.interests) ||
    !same(likes, state.prefs.likes) ||
    !same(avoids, state.prefs.avoids) ||
    !same(favorites, state.prefs.favoriteWriters);
  const taste = tasteFromFeedback(Object.values(state.feedback));
  const votes = Object.values(state.feedback).filter((f) => f.vote);

  const save = () => {
    if (!interests.length) return setMsg("Turn on at least one section.");
    reader.setPrefs({
      areas: draft,
      interests,
      likes: likes.filter((l) => !avoids.includes(l)),
      avoids,
      favoriteWriters: favorites,
      setup: state.prefs.setup ?? { text: "", source: "manual", at: new Date().toISOString() },
    });
    setMsg("Saved. Today's edition now follows these settings.");
  };
  const touch = () => setMsg("");

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
      setInterests(next.prefs.interests);
      setLikes(next.prefs.likes);
      setAvoids(next.prefs.avoids);
      setFavorites(next.prefs.favoriteWriters);
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
        <h1>Your edition</h1>
        <h2>What you told us</h2>
        {state.prefs.setup?.text ? <p className="setup-said">"{state.prefs.setup.text}"</p> : null}
        <p className="muted">
          {state.prefs.setup?.source === "starter"
            ? "We couldn't pick out what you like from your answer, so you started with Minnesota business news."
            : "Your edition was built from your own words. Say it again any time, or fine-tune the details below."}
        </p>
        <a className="pill-link" href={href.setup()}>Redo setup in your own words</a>

        <h2>Your places</h2>
        <p className="muted">Local stories follow these places. With no places, you get statewide and national news.</p>
        <AreaPicker value={draft} onChange={(ids) => { setDraft(ids); touch(); }} />

        <h2>Your sections</h2>
        <InterestPicker value={interests} onChange={(v) => { setInterests(v); touch(); }} />
        <h2>More of</h2>
        <p className="muted">Specific things to favor. A small nudge within your edition.</p>
        <TopicChips value={likes} onChange={(v) => { setLikes(v); touch(); }} label="More of" placeholder="e.g. value investing" max={MAX_LIKES} />
        <h2>Less of</h2>
        <p className="muted">Things you'd rather skip. These move stories down, never out, so big news still reaches you.</p>
        <TopicChips value={avoids} onChange={(v) => { setAvoids(v); touch(); }} label="Less of" placeholder="e.g. soccer" max={MAX_AVOIDS} />
        <h2>Writers you like</h2>
        <WriterPicker value={favorites} onChange={(v) => { setFavorites(v); touch(); }} />

        <div className="save-bar">
          <button className="pill-btn" onClick={save} disabled={!changed}>
            Save settings
          </button>
          {msg ? <span className="notice" role="status">{msg}</span> : null}
        </div>

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
          <button className="pill-btn" onClick={() => { reader.rebuildDeck(); setMsg("Today's edition rebuilt with your latest settings and votes."); }}>
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
          <button className="pill-btn ghost danger" onClick={() => { reader.resetAll(); setDraft([]); setInterests([]); setLikes([]); setAvoids([]); setMsg("Everything reset. You'll set up again on the next visit."); }}>
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
        <h1>About</h1>
        <p className="about-lead">
          Penpost is a short daily paper built around the places and things you care about. Tell it where you live and what you follow,
          and each weekday it hands you about five stories, then it stops.
        </p>
        <p>
          It exists because good news about your own town, your industry and your niche interests is scattered across dozens of sites,
          and most news apps are built to keep you scrolling. Penpost does the gathering for you and gives you an ending: about ten
          minutes, and you're caught up.
        </p>
        <p className="disclosure">Every story is written by an AI writer persona and links to its sources.</p>

        <h2>How your paper is put together</h2>
        <p>
          You tell Penpost what you want in your own words, and it turns that into places, sections and specific interests. Local
          stories come from your places; statewide and national stories come from your sections. Papers lean lighter: a heavy story
          gets in only when it's big news. Things you say you don't care about move down, never out, so big news for your places always
          gets through. On a quiet day the paper is shorter. Your optional thumbs gently reorder future papers on this device. Swiping
          past a story is never counted as a vote. You can fine-tune everything in Settings.
        </p>

        <h2>How stories are sourced</h2>
        <p>
          Writers work from company announcements, public records, and other reporting, then write a fresh account. A company's claim is
          reported as a claim. When a story relies on another outlet's reporting, it says so. Source names, links, and dates appear at
          the end of each article. Photos are licensed; generic ones are labeled "Stock photo" so they never read as the actual event.
        </p>

        <h2>The writers</h2>
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

        <h2>About the AI writers</h2>
        <p>
          Penpost's five writers are designed editorial personas written by AI. They are not real people: none of them has a hometown,
          an employment history, credentials, or personal experiences, and none conducts interviews or has firsthand knowledge of events.
          Each has a distinct voice and a stated lens, and each profile lists that writer's likely blind spots. Every writer covers every
          beat; a writer's lens shapes how a story is told, never which stories they get. Before publishing, an automated checker compares
          each story with the facts its sources report and holds anything it can't match. There is no human editor yet, so mistakes can
          still slip through.
        </p>
        <p className="fineprint">Penpost is an early version and still being shaped.</p>
      </main>
    </div>
  );
}

export function Papers({ reader }: { reader: Reader }) {
  const list = reader.pastEditions;
  return (
    <div className="screen">
      <Bar title="Past papers" />
      <main className="page">
        <h1>Past papers</h1>
        <p className="muted">Every weekday paper, picked for your places and interests.</p>
        {list.length ? (
          <ul className="paper-list">
            {list.map((e) => {
              const n = reader.storiesFor(e.id).length;
              return (
                <li key={e.id}>
                  <a href={href.paper(e.id)}>
                    <span className="paper-date">{formatEditionDate(e.date, "long")}</span>
                    <span className="paper-meta">
                      {n} {n === 1 ? "story" : "stories"}
                    </span>
                  </a>
                </li>
              );
            })}
          </ul>
        ) : (
          <p>No papers yet.</p>
        )}
      </main>
    </div>
  );
}

export function Paper({ reader, id }: { reader: Reader; id: string }) {
  const edition = reader.pastEditions.find((e) => e.id === id);
  const list = edition ? reader.storiesFor(edition.id) : [];
  return (
    <div className="screen">
      <Bar title="Past papers" />
      <main className="page">
        <h1>{edition ? formatEditionDate(edition.date, "long") : "Paper not found"}</h1>
        <ol className="story-list numbered">
          {list.map((s, i) => {
            const w = writerById.get(s.writerId)!;
            return (
              <li key={s.id}>
                <a href={href.story(s.slug)}>
                  <span className="story-list-n">{i + 1}</span>
                  <span>
                    <span className="story-list-h">{s.headline}</span>
                    <span className="story-list-m">
                      {w.name} · {s.estimatedReadMinutes} min
                    </span>
                  </span>
                </a>
              </li>
            );
          })}
        </ol>
        {edition && !list.length ? <p>No stories in this paper for your places and interests.</p> : null}
      </main>
    </div>
  );
}

export function Account() {
  return (
    <div className="screen">
      <Bar title="Account" />
      <main className="page">
        <h1>Create an account or log in</h1>
        <p>
          Accounts are coming soon. They'll let you keep your places and settings across your phone and computer.
        </p>
        <p className="muted">
          For now Penpost works without one: your places, settings and votes are saved on this device.
        </p>
        <a className="pill-link" href={href.settings()}>Your places and settings</a>
      </main>
    </div>
  );
}
