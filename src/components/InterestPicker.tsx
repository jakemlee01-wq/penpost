import { Avatar } from "./Avatar";
import { interestCatalog, writers } from "../lib/content";
import type { CategoryId, Interest, Scope } from "../lib/schema";
import { cleanPhrase } from "../lib/setupParse";

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

/** Free-form topics as removable chips, plus a box to add one. Used for likes and dislikes in Settings. */
export function TopicChips({
  value,
  onChange,
  label,
  placeholder,
  max,
}: {
  value: string[];
  onChange: (next: string[]) => void;
  label: string;
  placeholder: string;
  max: number;
}) {
  const add = (raw: string) => {
    const p = cleanPhrase(raw);
    if (p && !value.includes(p) && value.length < max) onChange([...value, p]);
  };
  return (
    <div className="topic-chips">
      <ul className="chips" aria-label={label}>
        {value.map((t) => (
          <li key={t}>
            <button className="chip-btn" onClick={() => onChange(value.filter((x) => x !== t))} aria-label={`Remove ${t}`}>
              {t} <span aria-hidden="true">×</span>
            </button>
          </li>
        ))}
        {value.length === 0 ? <li className="fineprint">None yet.</li> : null}
      </ul>
      <form
        className="chip-add"
        onSubmit={(e) => {
          e.preventDefault();
          const input = e.currentTarget.elements.namedItem("topic") as HTMLInputElement;
          add(input.value);
          input.value = "";
        }}
      >
        <input name="topic" type="text" placeholder={placeholder} aria-label={`Add to ${label.toLowerCase()}`} maxLength={40} />
        <button className="pill-btn ghost" type="submit">Add</button>
      </form>
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
