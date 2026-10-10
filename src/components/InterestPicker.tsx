import { Avatar } from "./Avatar";
import { interestCatalog, writers } from "../lib/content";
import type { CategoryId, Interest, Mood, Scope } from "../lib/schema";

type Choice = Scope | "off";
const CHOICES: { id: Choice; label: string }[] = [
  { id: "off", label: "Off" },
  { id: "local", label: "Local" },
  { id: "minnesota", label: "Minnesota" },
  { id: "national", label: "National" },
];

/** One row per section; pick how wide to look, or turn it off. */
export function InterestPicker({ value, onChange }: { value: Interest[]; onChange: (next: Interest[]) => void }) {
  const scopeOf = new Map(value.map((i) => [i.category, i.scope]));
  const set = (category: CategoryId, choice: Choice) => {
    const rest = value.filter((i) => i.category !== category);
    onChange(choice === "off" ? rest : [...rest, { category, scope: choice }]);
  };
  return (
    <div className="interests" role="list">
      {interestCatalog.categories.map((c) => {
        const current: Choice = scopeOf.get(c.id) ?? "off";
        return (
          <div key={c.id} className={`interest${current !== "off" ? " on" : ""}`} role="listitem">
            <span className="interest-name" id={`int-${c.id}`}>
              {c.name}
            </span>
            <div className="segctl" role="radiogroup" aria-labelledby={`int-${c.id}`}>
              {CHOICES.map((ch) => (
                <button
                  key={ch.id}
                  role="radio"
                  aria-checked={current === ch.id}
                  className={`seg-btn${current === ch.id ? (ch.id === "off" ? " on-off" : " on") : ""}`}
                  onClick={() => set(c.id, ch.id)}
                >
                  {ch.label}
                </button>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

const MOODS: { id: Mood; label: string; note: string }[] = [
  { id: 0, label: "Lighter", note: "Skip heavy stories like closings and layoffs." },
  { id: 1, label: "Balanced", note: "Everything, with lighter stories nudged up a little." },
  { id: 2, label: "Everything", note: "No preference. Stories ranked on place and interest only." },
];

export function MoodPicker({ value, onChange }: { value: Mood; onChange: (m: Mood) => void }) {
  const note = MOODS.find((m) => m.id === value)?.note;
  return (
    <div className="mood">
      <div className="segctl wide" role="radiogroup" aria-label="Mood">
        {MOODS.map((m) => (
          <button key={m.id} role="radio" aria-checked={value === m.id} className={`seg-btn${value === m.id ? " on" : ""}`} onClick={() => onChange(m.id)}>
            {m.label}
          </button>
        ))}
      </div>
      <p className="fineprint">{note} Big news for your places always gets through, whatever you pick.</p>
    </div>
  );
}

export function WriterPicker({ value, onChange }: { value: string[]; onChange: (ids: string[]) => void }) {
  const set = new Set(value);
  return (
    <div className="writer-picks">
      {writers.map((w) => (
        <button
          key={w.id}
          className={`writer-pick${set.has(w.id) ? " on" : ""}`}
          aria-pressed={set.has(w.id)}
          onClick={() => onChange(set.has(w.id) ? value.filter((x) => x !== w.id) : [...value, w.id])}
        >
          <Avatar writer={w} size={44} />
          <span className="writer-pick-name">{w.name}</span>
          <span className="writer-pick-tag">{w.tagline.replace(/^The /, "")}</span>
        </button>
      ))}
    </div>
  );
}
