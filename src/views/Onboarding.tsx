import { useCallback, useRef, useState } from "react";
import { Mic } from "../components/Icons";
import { areas } from "../lib/content";
import { href } from "../lib/router";
import { parserConfigured, runSetup } from "../lib/setupClient";
import { MAX_SETUP_CHARS, SETUP_EXAMPLE } from "../lib/setupParse";
import { useSpeech } from "../lib/useSpeech";
import type { Reader } from "../lib/useReader";

/**
 * First-run setup: one screen, one free-text answer, one button.
 * Personalization should be experienced, not configured: the reader says what they want in
 * their own words and lands on an edition. Granular controls live in Settings.
 */
export function Onboarding({ reader, redo = false }: { reader: Reader; redo?: boolean }) {
  const [text, setText] = useState(redo ? reader.state.prefs.setup?.text ?? "" : "");
  const [busy, setBusy] = useState(false);
  const textRef = useRef(text);
  textRef.current = text;
  const getText = useCallback(() => textRef.current, []);
  const speech = useSpeech(getText, (t) => setText(t.slice(0, MAX_SETUP_CHARS)));

  const submit = async () => {
    if (busy) return;
    speech.stop();
    setBusy(true);
    const result = await runSetup(text, areas);
    reader.completeSetup(text.trim(), result);
    if (redo) window.location.hash = href.deck();
  };

  return (
    <div className="screen onboarding">
      <header className="topbar">
        <span className="brand">penpost</span>
        {redo ? (
          <a className="topbar-date" href={href.settings()}>
            Cancel
          </a>
        ) : null}
      </header>

      <main className="page setup">
        <h1 id="setup-h">What news do you want?</h1>
        <p className="muted">
          Tell us in your own words: where you live or grew up, what you follow, and what you'd rather skip. Type it or tap the mic.
        </p>

        <div className={`setup-box${speech.listening ? " listening" : ""}`}>
          <textarea
            className="setup-input"
            aria-labelledby="setup-h"
            value={text}
            maxLength={MAX_SETUP_CHARS}
            rows={5}
            placeholder="I live in…, I follow…, I don't care about…"
            onChange={(e) => setText(e.target.value)}
            disabled={busy}
          />
          {speech.supported ? (
            <button
              type="button"
              className={`mic-btn${speech.listening ? " on" : ""}`}
              onClick={speech.listening ? speech.stop : speech.start}
              aria-pressed={speech.listening}
              aria-label={speech.listening ? "Stop voice input" : "Speak your answer"}
              disabled={busy}
            >
              <Mic />
              <span>{speech.listening ? "Listening… tap to stop" : "Speak"}</span>
            </button>
          ) : null}
        </div>
        {speech.error ? (
          <p className="fineprint" role="status">
            {speech.error}
          </p>
        ) : null}

        <figure className="setup-example">
          <figcaption>For example</figcaption>
          <blockquote>{SETUP_EXAMPLE}</blockquote>
        </figure>

        <p className="fineprint">
          No account needed.{" "}
          {parserConfigured
            ? "Penpost sends your answer once to an AI model to set up your edition and doesn't keep it on a server."
            : "Your answer is read in your browser."}{" "}
          Your settings stay on this device. Stories are written by AI writers and checked automatically against their sources.{" "}
          <a href={href.about()}>How Penpost works</a>
        </p>
      </main>

      <div className="cta-bar">
        <button className="cta" onClick={submit} disabled={busy}>
          {busy ? "Reading your answer…" : "Show my edition"}
        </button>
      </div>
    </div>
  );
}
