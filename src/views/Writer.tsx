import { Avatar } from "../components/Avatar";
import { ChevronLeft } from "../components/Icons";
import { stories, writerById } from "../lib/content";
import { goBack, href } from "../lib/router";

export function WriterProfile({ id }: { id: string }) {
  const writer = writerById.get(id);
  if (!writer) {
    return (
      <div className="screen">
        <main className="empty">
          <h1>Writer not found</h1>
          <a className="pill-link" href={href.about()}>Meet the writers</a>
        </main>
      </div>
    );
  }
  const recent = stories
    .filter((s) => s.writerId === writer.id)
    .sort((a, b) => b.publishedAt.localeCompare(a.publishedAt))
    .slice(0, 6);

  return (
    <div className="screen">
      <header className="article-bar">
        <button className="back-btn" onClick={() => goBack()} aria-label="Back">
          <ChevronLeft /> <span>Back</span>
        </button>
      </header>
      <main className="profile">
        <div className="profile-head">
          <Avatar writer={writer} size={120} decorative={false} />
          <h1>{writer.name}</h1>
          <p className="profile-tagline">{writer.tagline}</p>
          <span className="ai-badge large">AI writer</span>
          <span className="pronouns">{writer.pronouns}</span>
        </div>

        <section>
          <h2>About this writer</h2>
          <p>{writer.bio}</p>
        </section>
        <section>
          <h2>Tone and style</h2>
          <p className="tone-list">{writer.tone.join(" · ")}</p>
          <p>{writer.writingStyle}</p>
          <blockquote className="voice">{writer.exampleVoice}</blockquote>
          <p className="fineprint">Example of style only, not a news item.</p>
        </section>
        <section>
          <h2>Character background</h2>
          <p>{writer.background}</p>
          <p>Every Penpost writer covers every beat. A writer's lens shapes how a story is told, never which stories they get.</p>
        </section>
        <section>
          <h2>Strengths</h2>
          <ul className="plain-list">{writer.strengths.map((s) => <li key={s}>{s}</li>)}</ul>
        </section>
        <p className="blind-spots">
          <strong>Blind spots:</strong> {blindSpots(writer.potentialBias)}
        </p>
        <section>
          <h2>Recent stories</h2>
          {recent.length ? (
            <ul className="story-list">
              {recent.map((s) => (
                <li key={s.id}>
                  <a href={href.story(s.slug)}>
                    <span className="story-list-h">{s.headline}</span>
                    {s.isDemo ? <span className="chip inline">Demo</span> : null}
                  </a>
                </li>
              ))}
            </ul>
          ) : (
            <p>No stories yet.</p>
          )}
        </section>
      </main>
    </div>
  );
}

/** "May overvalue X." + "May connect Y." -> "may overvalue X; may connect Y." */
function blindSpots(items: string[]): string {
  return items.map((s, i) => (i === 0 ? s : s.charAt(0).toLowerCase() + s.slice(1)).replace(/\.$/, "")).join("; ") + ".";
}
