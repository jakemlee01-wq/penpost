import { useEffect, useMemo, useRef, useState } from "react";
import { TopBar } from "../components/TopBar";
import { areas } from "../lib/content";
import { CURATE_TIMEOUT_MS, GRACE_MS, POLL_MS, bundleHas, paperStatus, reloadFresh, requestPaper, type CurateReply } from "../lib/curate";
import { formatEditionDate } from "../lib/dates";
import { href } from "../lib/router";
import { curatingLines } from "../lib/topics";
import type { Reader } from "../lib/useReader";

/** Weekday, before the tap: one calm screen, one button. */
export function PaperGate({ reader }: { reader: Reader }) {
  return (
    <div className="screen">
      <TopBar dateLabel={formatEditionDate(reader.today)} />
      <main className="paper-gate">
        <div className="sun" aria-hidden="true" />
        <h1>{greeting()}</h1>
        <p className="paper-gate-lead">Your paper is written fresh when you ask for it, from the places and sections you picked.</p>
        <button className="cta paper-cta" onClick={reader.askForPaper}>
          See today's paper
        </button>
        <p className="paper-gate-links">
          <a href={href.papers()}>Past papers</a>
          <span aria-hidden="true"> · </span>
          <a href={href.settings()}>Settings</a>
        </p>
      </main>
    </div>
  );
}

function greeting(now = new Date()): string {
  const hour = Number(new Intl.DateTimeFormat("en-US", { timeZone: "America/Chicago", hour: "numeric", hourCycle: "h23" }).format(now));
  return hour < 12 ? "Good morning." : hour < 17 ? "Good afternoon." : "Good evening.";
}

/** After the tap: wait for the Worker to say the reader's topics are written and deployed. */
export function Curating({ reader }: { reader: Reader }) {
  const c = reader.curating!;
  const lines = useMemo(() => curatingLines(c.topics, areas.regions), [c.topics]);
  const [line, setLine] = useState(0);
  const [progress, setProgress] = useState<{ ready: number; total: number } | null>(null);
  // The poll loop reads the latest reader through a ref so it isn't restarted on every render.
  const readerRef = useRef(reader);
  readerRef.current = reader;

  useEffect(() => {
    const t = setInterval(() => setLine((i) => (i + 1) % lines.length), 4200);
    return () => clearInterval(t);
  }, [lines.length]);

  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const started = Date.parse(c.startedAt);
    let requested = Boolean(c.requested);

    const handle = (r: CurateReply): boolean => {
      const rd = readerRef.current;
      const age = Date.now() - started;
      if (r.status === "error") {
        rd.finishPaper(true);
        return true;
      }
      if (r.status === "ready") {
        if (bundleHas(r.readyAt)) {
          rd.finishPaper(false);
          return true;
        }
        // The stories are live but this page is an older build: load the new one (at most every 20 seconds).
        const last = rd.state.curating?.reloadedAt ? Date.parse(rd.state.curating.reloadedAt) : 0;
        if (Date.now() - last > 20_000) {
          rd.markReloaded();
          reloadFresh();
          return true;
        }
        return false;
      }
      if (r.status === "failed") {
        // Right after the tap the new run may not be listed yet. After that, failed is failed.
        if (age > GRACE_MS) {
          rd.finishPaper(true);
          return true;
        }
        return false;
      }
      if (r.status === "generating") setProgress({ ready: r.ready, total: r.total });
      return false;
    };

    const tick = async () => {
      if (stopped) return;
      // Past the wait limit, one last look (a reader coming back to the app may find it ready), then fall back.
      const late = Date.now() - started > CURATE_TIMEOUT_MS;
      if (late && !requested) {
        readerRef.current.finishPaper(true);
        return;
      }
      let r: CurateReply;
      if (!requested) {
        r = await requestPaper(c.date, c.topics);
        if (r.status !== "busy" && r.status !== "error") {
          requested = true;
          readerRef.current.markRequested();
        }
      } else {
        r = await paperStatus(c.date, c.topics);
      }
      if (stopped) return;
      if ((!late || r.status === "ready") && handle(r)) return;
      if (late) {
        readerRef.current.finishPaper(true);
        return;
      }
      timer = setTimeout(tick, POLL_MS);
    };
    void tick();
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
    };
    // One loop per tap.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [c.startedAt]);

  return (
    <div className="screen">
      <TopBar dateLabel={formatEditionDate(reader.today)} />
      <main className="curating" aria-busy="true">
        <PenStroke />
        <h1>Curating your paper for today.</h1>
        <p className="curating-line" aria-live="polite" key={line}>
          {lines[line]}
        </p>
        {progress && progress.total > 1 && progress.ready > 0 ? (
          <p className="curating-progress">
            {progress.ready} of {progress.total} topics ready
          </p>
        ) : null}
        <p className="curating-note">This can take a few minutes.</p>
      </main>
    </div>
  );
}

/** A slow pen stroke writing a line, then resting. Static under reduced motion (see app.css). */
function PenStroke() {
  return (
    <svg className="pen-stroke" viewBox="0 0 160 64" aria-hidden="true">
      <rect x="8" y="10" width="144" height="44" rx="10" className="pen-paper" />
      <path className="pen-line" pathLength="1" d="M24 38 C 36 22, 44 46, 56 32 S 76 24, 86 36 S 108 44, 118 30 S 132 28, 138 34" />
    </svg>
  );
}
