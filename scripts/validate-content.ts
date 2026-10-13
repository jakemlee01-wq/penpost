/**
 * Validates every content file before a build. Fails loudly on:
 * schema errors, unknown writers/towns/stories, duplicate ids or slugs,
 * retired writer names, em dashes, templated "Why it matters" labels,
 * missing demo labels, and word counts far outside the budget.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { parseStoryFile } from "../src/lib/parse";
import { AreasSchema } from "../src/lib/areas";
import { EditionManifestSchema, WriterSchema, WRITER_IDS } from "../src/lib/schema";

const root = join(import.meta.dirname, "..", "content");
const errors: string[] = [];
const warnings: string[] = [];

const writers = WriterSchema.array().parse(JSON.parse(readFileSync(join(root, "writers/writers.json"), "utf8")));
const areas = AreasSchema.parse(JSON.parse(readFileSync(join(root, "areas.json"), "utf8")));
const towns = areas.towns;
const townIds = new Set(towns.map((t) => t.id));
const regionIds = new Set(areas.regions.map((r) => r.id));
const countyIds = new Set(areas.counties.map((c) => c.id));
for (const c of areas.counties) if (!regionIds.has(c.region)) errors.push(`areas.json: county ${c.id} has unknown region ${c.region}`);
for (const t of areas.towns) if (!countyIds.has(t.county)) errors.push(`areas.json: town ${t.id} has unknown county ${t.county}`);

if (writers.map((w) => w.id).sort().join() !== [...WRITER_IDS].sort().join()) errors.push("writers.json must contain exactly emma, jack, grace, luke, ben");

const storyDir = join(root, "stories");
const ids = new Set<string>();
const slugs = new Set<string>();
const storiesById = new Map<string, ReturnType<typeof parseStoryFile>>();

for (const file of readdirSync(storyDir).filter((f) => f.endsWith(".md"))) {
  const raw = readFileSync(join(storyDir, file), "utf8");
  try {
    const s = parseStoryFile(raw, file);
    if (ids.has(s.id)) errors.push(`${file}: duplicate id ${s.id}`);
    if (slugs.has(s.slug)) errors.push(`${file}: duplicate slug ${s.slug}`);
    ids.add(s.id);
    slugs.add(s.slug);
    storiesById.set(s.id, s);
    for (const c of s.cities) if (!townIds.has(c)) errors.push(`${file}: unknown town "${c}" (add it to areas.json)`);
    if (raw.includes("—")) errors.push(`${file}: contains an em dash`);
    if (/why it matters/i.test(s.bodyMarkdown)) errors.push(`${file}: templated "Why it matters" label`);
    if (s.isDemo && !/demo/i.test(s.bodyMarkdown)) errors.push(`${file}: demo story must say so in the body`);
    if (!s.isDemo && s.sources.some((src) => /example\.(com|org)/.test(src.url))) errors.push(`${file}: real story uses a placeholder source URL`);
    if (s.wordCount > 700) warnings.push(`${file}: ${s.wordCount} words (budget ~220-660, a 1 to 3 minute read)`);
    if (s.significance !== "local" && s.wordCount < 120) warnings.push(`${file}: only ${s.wordCount} words`);
  } catch (e) {
    errors.push((e as Error).message);
  }
}

for (const file of readdirSync(join(root, "editions")).filter((f) => f.endsWith(".json"))) {
  const parsed = EditionManifestSchema.safeParse(JSON.parse(readFileSync(join(root, "editions", file), "utf8")));
  if (!parsed.success) {
    errors.push(`editions/${file}: ${parsed.error.message}`);
    continue;
  }
  if (`${parsed.data.date}.json` !== file) errors.push(`editions/${file}: file name must match date`);
  for (const id of parsed.data.candidateStoryIds) {
    const s = storiesById.get(id);
    if (!s) errors.push(`editions/${file}: unknown story ${id}`);
    else if (s.isDemo && !parsed.data.isDemo) errors.push(`editions/${file}: demo story ${id} in a non-demo edition`);
  }
}

const all = readdirSync(root, { recursive: true }).filter((f) => typeof f === "string" && /\.(md|json)$/.test(f)) as string[];
const retired = /\b(byline:|beat owner)\b/i;
for (const f of all) if (retired.test(readFileSync(join(root, f), "utf8"))) errors.push(`${f}: retired concept found`);

for (const w of warnings) console.warn(`warn  ${w}`);
if (errors.length) {
  for (const e of errors) console.error(`error ${e}`);
  process.exit(1);
}
const words = [...storiesById.values()].map((s) => `${s.slug}: ${s.wordCount}`);
console.log(`Content OK: ${writers.length} writers, ${towns.length} towns, ${storiesById.size} stories.\n  ${words.join("\n  ")}`);
