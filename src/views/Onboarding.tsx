import { useState } from "react";
import { AreaPicker } from "../components/AreaPicker";
import { href } from "../lib/router";
import type { Reader } from "../lib/useReader";

export function Onboarding({ reader }: { reader: Reader }) {
  const [picks, setPicks] = useState<string[]>([]);
  return (
    <div className="screen onboarding">
      <header className="topbar">
        <span className="brand">Penpost</span>
      </header>
      <main className="page">
        <h1>Where do you want news from?</h1>
        <p className="muted">
          Pick any mix of regions, counties and towns. Your edition follows these places, plus big statewide stories. Penpost remembers your
          picks on this device. No account needed.
        </p>
        <AreaPicker value={picks} onChange={setPicks} />
        <p className="fineprint">
          Written by AI writers and reviewed before publishing. <a href={href.about()}>How Penpost works</a>
        </p>
      </main>
      <div className="cta-bar">
        <button className="cta" disabled={!picks.length} onClick={() => reader.setAreas(picks)}>
          {picks.length ? "Show my edition" : "Pick at least one place"}
        </button>
      </div>
    </div>
  );
}
