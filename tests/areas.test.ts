import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { AreasSchema, areaLabel, expandAreas, normalizeAreaIds, townsWithRegion } from "../src/lib/areas";
import { eligibility } from "../src/lib/ranking";
import { parseStoryFile } from "../src/lib/parse";

const areas = AreasSchema.parse(JSON.parse(readFileSync(join(__dirname, "..", "content", "areas.json"), "utf8")));
const towns = townsWithRegion(areas);
const fixture = (f: string) => parseStoryFile(readFileSync(join(__dirname, "fixtures", "stories", f), "utf8"), f);

describe("areas", () => {
  it("expands a county to its towns", () => {
    expect(expandAreas(["county:lac-qui-parle"], areas)).toEqual(["dawson", "madison"]);
  });
  it("expands a region to every town in its counties", () => {
    const tc = expandAreas(["region:twin-cities"], areas);
    expect(tc).toContain("minneapolis");
    expect(tc).toContain("st-paul");
    expect(tc).toContain("woodbury");
    expect(tc).not.toContain("dawson");
  });
  it("combines mixed picks without duplicates", () => {
    const ids = expandAreas(["region:twin-cities", "county:hennepin", "town:dawson"], areas);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toContain("dawson");
  });
  it("labels picks by name", () => {
    expect(areaLabel(["region:twin-cities", "town:dawson"], areas)).toBe("Twin Cities metro + Dawson");
  });
  it("drops unknown IDs and upgrades plain town IDs", () => {
    expect(normalizeAreaIds(["minneapolis", "town:nowhere", "county:hennepin", 3], areas)).toEqual(["town:minneapolis", "county:hennepin"]);
  });
  it("every county points at a real region and every town at a real county", () => {
    const regions = new Set(areas.regions.map((r) => r.id));
    const counties = new Set(areas.counties.map((c) => c.id));
    for (const c of areas.counties) expect(regions.has(c.region)).toBe(true);
    for (const t of areas.towns) expect(counties.has(t.county)).toBe(true);
  });
  it("picking a county includes that county's local stories", () => {
    const readerTowns = expandAreas(["county:lac-qui-parle"], areas);
    expect(eligibility(fixture("dawson-hardware-new-owners.md"), readerTowns, towns).eligible).toBe(true);
    expect(eligibility(fixture("lantern-coffee-second-shop.md"), readerTowns, towns).eligible).toBe(false);
  });
});

describe("statewide stories without a town", () => {
  it("reach every reader but never count as local", () => {
    const s = { ...fixture("rochester-device-expansion.md"), cities: [] as string[] };
    const e = eligibility(s, expandAreas(["region:twin-cities"], areas), towns);
    expect(e.eligible).toBe(true);
    expect(e.base).toBe(70);
    expect(eligibility(s, ["dawson"], towns).eligible).toBe(true);
  });
});
