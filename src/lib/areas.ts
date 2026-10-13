import { z } from "zod";
import type { Town } from "./schema";

/**
 * Readers pick areas at any level: a region ("Twin Cities metro"), a county
 * ("Lac qui Parle County"), or a town ("Dawson"). Area IDs are prefixed by
 * kind, e.g. "region:twin-cities", "county:lac-qui-parle", "town:dawson".
 * Ranking works on towns, so every pick expands to a set of town IDs.
 */

export const AreasSchema = z.object({
  regions: z.array(z.object({ id: z.string(), name: z.string(), hub: z.string().optional() })).min(1),
  counties: z.array(z.object({ id: z.string(), name: z.string(), region: z.string() })).min(1),
  towns: z.array(z.object({ id: z.string().regex(/^[a-z0-9-]+$/), name: z.string(), county: z.string() })).min(1),
});
export type Areas = z.infer<typeof AreasSchema>;
export type AreaKind = "region" | "county" | "town";
export type AreaOption = { id: string; kind: AreaKind; name: string };

export function townsWithRegion(areas: Areas): Town[] {
  const regionOf = new Map(areas.counties.map((c) => [c.id, c.region]));
  return areas.towns.map((t) => ({ id: t.id, name: t.name, region: regionOf.get(t.county) ?? "unknown" }));
}

export function areaOptions(areas: Areas): AreaOption[] {
  return [
    ...areas.regions.map((r) => ({ id: `region:${r.id}`, kind: "region" as const, name: r.name })),
    ...areas.counties.map((c) => ({ id: `county:${c.id}`, kind: "county" as const, name: c.name })),
    ...areas.towns.map((t) => ({ id: `town:${t.id}`, kind: "town" as const, name: t.name })),
  ];
}

/** Expand picked areas to the sorted, de-duplicated list of town IDs they cover. */
export function expandAreas(areaIds: string[], areas: Areas): string[] {
  const regionOf = new Map(areas.counties.map((c) => [c.id, c.region]));
  const out = new Set<string>();
  for (const raw of areaIds) {
    const [kind, id] = raw.split(":");
    for (const t of areas.towns) {
      if (
        (kind === "town" && t.id === id) ||
        (kind === "county" && t.county === id) ||
        (kind === "region" && regionOf.get(t.county) === id)
      ) {
        out.add(t.id);
      }
    }
  }
  return [...out].sort();
}

export function areaLabel(areaIds: string[], areas: Areas): string {
  const names = new Map(areaOptions(areas).map((o) => [o.id, o.name]));
  return areaIds.map((id) => names.get(id) ?? id).join(" + ");
}

/** Accept only known area IDs; upgrade older saved data that stored plain town IDs. */
export function normalizeAreaIds(ids: unknown, areas: Areas): string[] {
  if (!Array.isArray(ids)) return [];
  const known = new Set(areaOptions(areas).map((o) => o.id));
  const out: string[] = [];
  for (const raw of ids) {
    if (typeof raw !== "string") continue;
    const id = raw.includes(":") ? raw : `town:${raw}`;
    if (known.has(id) && !out.includes(id)) out.push(id);
  }
  return out;
}
