import { useMemo } from "react";
import { Avatar } from "../components/Avatar";
import { StoryImage, imageCaption } from "../components/StoryImage";
import { ChevronLeft, ExternalLink } from "../components/Icons";
import { storyBySlug, townNames, writerById } from "../lib/content";
import { formatSourceDate } from "../lib/dates";
import { renderMarkdown } from "../lib/markdown";
import { goBack, href } from "../lib/router";

function ImageCaption({ story }: { story: Parameters<typeof imageCaption>[0] }) {
  const c = imageCaption(story);
  if (!c) return null;
  return (
    <figcaption>
      {c.text}
      {c.unsplash ? (
        <>
          {" · Photo by "}
          <a href={c.unsplash.profile} target="_blank" rel="noopener noreferrer">
            {c.unsplash.name}
          </a>
          {" on "}
          <a href={c.unsplash.photo} target="_blank" rel="noopener noreferrer">
            Unsplash
          </a>
        </>
      ) : null}
      {c.credit ? (
        <>
          {" · "}
          <a href={c.link} target="_blank" rel="noopener noreferrer">
            {c.credit}
          </a>
        </>
      ) : null}
    </figcaption>
  );
}

export function Article({ slug }: { slug: string }) {
  const story = storyBySlug.get(slug);
  const html = useMemo(() => (story ? renderMarkdown(story.bodyMarkdown) : ""), [story]);

  if (!story) {
    return (
      <div className="screen">
        <main className="empty">
          <h1>Story not found</h1>
          <p>This link doesn't match a story in Penpost.</p>
          <a className="pill-link" href={href.deck()}>Today's paper</a>
        </main>
      </div>
    );
  }
  const writer = writerById.get(story.writerId)!;

  return (
    <div className="screen article-screen">
      <header className="article-bar">
        <button className="back-btn" onClick={() => goBack()} aria-label="Back">
          <ChevronLeft /> <span>Back</span>
        </button>
      </header>
      <main className="article">
        {story.image ? (
          <figure className="article-figure">
            <StoryImage story={story} className="article-img" variant="article" />
            <ImageCaption story={story} />
          </figure>
        ) : null}
        <p className="article-kicker">
          {story.cities.length ? townNames(story.cities) : "Minnesota"} · {story.estimatedReadMinutes} min read
        </p>
        <h1 className="article-headline">{story.headline}</h1>
        {story.isDemo ? (
          <p className="demo-note">
            Demo story. The companies, people, and amounts are fictional examples used to test Penpost, not current news.
          </p>
        ) : null}
        {story.correctionNote ? <p className="correction">Update: {story.correctionNote}</p> : null}
        <div className="article-body" dangerouslySetInnerHTML={{ __html: html }} />

        <section className="sources" aria-labelledby="sources-h">
          <h2 id="sources-h">Sources</h2>
          <ul>
            {story.sources.map((s) => (
              <li key={s.url}>
                <a href={s.url} target="_blank" rel="noopener noreferrer">
                  {s.title} <ExternalLink />
                </a>
                <span className="source-meta">
                  {s.publisher}
                  {s.publishedAt ? `, ${formatSourceDate(s.publishedAt)}` : ""}
                </span>
              </li>
            ))}
          </ul>
        </section>

        <a className="byline" href={href.writer(writer.id)}>
          <Avatar writer={writer} size={48} />
          <span className="byline-text">
            <span className="byline-name">Written by {writer.name}</span>
            <span className="ai-badge">AI writer</span>
          </span>
        </a>
      </main>
    </div>
  );
}
