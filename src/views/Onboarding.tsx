import { useState } from "react";
import { AreaPicker } from "../components/AreaPicker";
import { InterestPicker, MoodPicker, WriterPicker } from "../components/InterestPicker";
import { href } from "../lib/router";
import type { Interest, Mood } from "../lib/schema";
import type { Reader } from "../lib/useReader";

const STARTER: Interest[] = [{ category: "business", scope: "minnesota" }];

export function Onboarding({ reader }: { reader: Reader }) {
  const prefs = reader.state.prefs;
  const [step, setStep] = useState<1 | 2>(reader.needsAreas ? 1 : 2);
  const [areas, setAreas] = useState<string[]>(prefs.areas);
  const [interests, setInterests] = useState<Interest[]>(prefs.interests.length ? prefs.interests : STARTER);
  const [mood, setMood] = useState<Mood>(prefs.mood);
  const [favorites, setFavorites] = useState<string[]>(prefs.favoriteWriters);

  const finish = () => reader.setPrefs({ areas, interests, mood, favoriteWriters: favorites });

  return (
    <div className="screen onboarding">
      <header className="topbar">
        <span className="brand">penpost</span>
        <span className="topbar-date">Step {step} of 2</span>
      </header>

      {step === 1 ? (
        <main className="page">
          <h1>Where do you want news from?</h1>
          <p className="muted">
            Pick any mix of regions, counties and towns. Local stories follow these places. Penpost remembers your picks on this device. No account
            needed.
          </p>
          <AreaPicker value={areas} onChange={setAreas} />
          <p className="fineprint">
            Written by AI writers and reviewed before publishing. <a href={href.about()}>How Penpost works</a>
          </p>
        </main>
      ) : (
        <main className="page">
          <h1>What do you want to read about?</h1>
          <p className="muted">
            For each section, choose how wide to look. Local means your places. Minnesota adds statewide news, and National adds U.S. news. You get
            about five stories a day, with at least one from each section you turn on when there's news.
          </p>
          <InterestPicker value={interests} onChange={setInterests} />
          <h2>How should the day feel?</h2>
          <MoodPicker value={mood} onChange={setMood} />
          <h2>Writers you like (optional)</h2>
          <p className="muted">A small nudge toward their stories. Every writer still covers every section.</p>
          <WriterPicker value={favorites} onChange={setFavorites} />
          <button className="text-btn" onClick={() => setStep(1)}>
            Back to places
          </button>
        </main>
      )}

      <div className="cta-bar">
        {step === 1 ? (
          <button className="cta" disabled={!areas.length} onClick={() => setStep(2)}>
            {areas.length ? "Next: your interests" : "Pick at least one place"}
          </button>
        ) : (
          <button className="cta" disabled={!interests.length || !areas.length} onClick={finish}>
            {!areas.length ? "Pick a place first" : interests.length ? "Show my edition" : "Turn on at least one section"}
          </button>
        )}
      </div>
    </div>
  );
}
