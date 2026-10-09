import { useMemo, useState } from "react";
import { areaOptions, type AreaKind } from "../lib/areas";
import { areas, expand } from "../lib/content";
import { Close } from "./Icons";

const SECTIONS: { kind: AreaKind; title: string }[] = [
  { kind: "region", title: "Regions" },
  { kind: "county", title: "Counties" },
  { kind: "town", title: "Towns" },
];

/** Pick any mix of regions, counties and towns. Controlled: the parent owns the selection. */
export function AreaPicker({ value, onChange }: { value: string[]; onChange: (ids: string[]) => void }) {
  const [query, setQuery] = useState("");
  const options = useMemo(() => areaOptions(areas), []);
  const byId = useMemo(() => new Map(options.map((o) => [o.id, o])), [options]);
  const q = query.trim().toLowerCase();
  const selected = new Set(value);
  const coverage = expand(value).length;

  const toggle = (id: string) => onChange(selected.has(id) ? value.filter((v) => v !== id) : [...value, id]);

  return (
    <div className="picker">
      {value.length ? (
        <div className="picks" aria-label="Your picks">
          {value.map((id) => (
            <button key={id} className="pick" onClick={() => toggle(id)} aria-label={`Remove ${byId.get(id)?.name ?? id}`}>
              {byId.get(id)?.name ?? id}
              <Close />
            </button>
          ))}
          <span className="picks-note">
            Covers {coverage} {coverage === 1 ? "town" : "towns"}
          </span>
        </div>
      ) : null}

      <label className="search">
        <span className="sr-only">Search areas</span>
        <input
          id="area-search"
          type="search"
          placeholder="Search a town, county or region"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          autoComplete="off"
        />
      </label>

      {SECTIONS.map(({ kind, title }) => {
        const items = options.filter((o) => o.kind === kind && (!q || o.name.toLowerCase().includes(q)));
        if (!items.length) return null;
        return (
          <section key={kind} className="picker-section" aria-label={title}>
            <h3>{title}</h3>
            <div className="chips">
              {items.map((o) => (
                <button key={o.id} className={`town${selected.has(o.id) ? " on" : ""}`} aria-pressed={selected.has(o.id)} onClick={() => toggle(o.id)}>
                  {o.name}
                </button>
              ))}
            </div>
          </section>
        );
      })}
      {q && !options.some((o) => o.name.toLowerCase().includes(q)) ? (
        <p className="muted">No match for "{query}". Penpost covers these places for now; more can be added.</p>
      ) : null}
    </div>
  );
}
