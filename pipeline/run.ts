/**
 * Daily Penpost drafting job.
 *
 *   npx tsx pipeline/run.ts [--date YYYY-MM-DD] [--feeds-dir path] [--out-dir path] [--max-stories 10]
 *
 * 1. Read enabled feeds from pipeline/sources.json (plain code, no model).
 * 2. Drop old items and anything already published.
 * 3. Triage with the cheap model: is it Minnesota business news, which towns, how significant.
 * 4. For each pick: extract a fact record, draft in an assigned writer's voice, then check the
 *    draft against the facts. Stories with unsupported statements are saved as status "draft"
 *    so they never publish without a human edit.
 * 5. Write story files and the edition manifest, plus pipeline/out/summary.md for the pull request.
 *
 * The workflow opens a pull request. Nothing reaches the site until Jake merges it.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { z } from "zod";
import { AreasSchema } from "../src/lib/areas";
import { chicagoDate } from "../src/lib/dates";
import { parseStoryFile } from "../src/lib/parse";
import { CATEGORY_IDS, WriterSchema, type Writer } from "../src/lib/schema";
import { fetchSource, filterCandidates, type Candidate, type Source } from "./feeds";
import { createModel, parseJson, type Call, type Model } from "./model";
import { CHECK_SYSTEM, FACTS_SYSTEM, checkPrompt, factsPrompt, triagePrompt, triageSystem, writerPrompt, writerSystem, type Facts } from "./prompts";

const TriageSchema = z.object({
  items: z.array(
    z.object({
      i: z.number(),
      keep: z.boolean(),
      reason: z.string().default(""),
      cities: z.array(z.string()).default([]),
      significance: z.enum(["local", "regional", "statewide", "national"]).catch("local"),
      categories: z.array(z.enum(CATEGORY_IDS).catch("business")).min(1).catch(["business"]),
      tone: z.enum(["light", "neutral", "heavy"]).catch("neutral"),
      mustKnow: z.boolean().catch(false),
      significanceReason: z.string().default(""),
      topics: z.array(z.string()).default([]),
      storyKey: z.string().default(""),
    }),
  ),
});
const DraftSchema = z.object({
  headline: z.string().min(5),
  preview: z.string().min(10),
  bodyMarkdown: z.string().min(200),
  scene: z.enum(["cafe", "office", "van", "mainstreet", "farm", "factory", "industrial", "road"]).catch("mainstreet"),
  imageAlt: z.string().min(5),
});
const CheckSchema = z.object({ unsupported: z.array(z.string()).default([]), styleIssues: z.array(z.string()).default([]) });

export type RunOptions = {
  root: string;
  date?: string;
  now?: Date;
  feedsDir?: string;
  outDir?: string;
  maxStories?: number;
  model?: Model;
  log?: (msg: string) => void;
};

export type RunResult = { written: { file: string; status: string; writer: string; flags: string[] }[]; skipped: string[]; summaryPath: string };

export function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60)
    .replace(/-$/, "");
}

/** Remove things the validator rejects, without changing meaning. */
export function tidy(s: string): string {
  return s
    .replace(/\s*—\s*/g, ", ")
    .replace(/\s*–\s*/g, " to ")
    .replace(/^\s*#+\s.*$/gm, "")
    .replace(/^\s*why it matters:?\s*/gim, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Least-used writer across recent stories and this run, never the same as the previous pick. */
export function pickWriter(writers: Writer[], recentIds: string[], previous?: string): Writer {
  const counts = new Map<string, number>(writers.map((w) => [w.id, 0]));
  for (const id of recentIds.slice(-30)) counts.set(id, (counts.get(id) ?? 0) + 1);
  return [...writers]
    .filter((w) => w.id !== previous || writers.length === 1)
    .sort((a, b) => counts.get(a.id)! - counts.get(b.id)! || a.id.localeCompare(b.id))[0];
}

async function ask<S extends z.ZodTypeAny>(model: Model, call: Call, schema: S): Promise<z.output<S>> {
  const reply = await model.complete({ ...call, json: true });
  return schema.parse(parseJson(reply));
}

export async function runPipeline(opts: RunOptions): Promise<RunResult> {
  const log = opts.log ?? console.log;
  const root = opts.root;
  const now = opts.now ?? new Date();
  const date = opts.date ?? chicagoDate(now);
  const maxStories = opts.maxStories ?? 12;
  const outDir = opts.outDir ?? join(root, "pipeline", "out");
  mkdirSync(outDir, { recursive: true });

  const sourcesFile = JSON.parse(readFileSync(join(root, "pipeline", "sources.json"), "utf8")) as { sources: Source[] };
  const areas = AreasSchema.parse(JSON.parse(readFileSync(join(root, "content", "areas.json"), "utf8")));
  const townIds = new Set(areas.towns.map((t) => t.id));
  const writers = WriterSchema.array().parse(JSON.parse(readFileSync(join(root, "content", "writers", "writers.json"), "utf8")));
  const storyDir = join(root, "content", "stories");
  const existing = readdirSync(storyDir)
    .filter((f) => f.endsWith(".md"))
    .map((f) => parseStoryFile(readFileSync(join(storyDir, f), "utf8"), f))
    .sort((a, b) => a.publishedAt.localeCompare(b.publishedAt));
  const knownUrls = new Set(existing.flatMap((s) => s.sources.map((x) => x.url)));
  const existingSlugs = new Set(existing.map((s) => s.slug));

  // 1-2. Fetch and filter (no model)
  const enabled = sourcesFile.sources.filter((s) => s.enabled);
  const readLocal = opts.feedsDir ? async (s: Source) => (existsSync(join(opts.feedsDir!, `${s.id}.xml`)) ? readFileSync(join(opts.feedsDir!, `${s.id}.xml`), "utf8") : null) : undefined;
  const fetched: Candidate[] = [];
  for (const s of enabled) {
    try {
      const items = await fetchSource(s, readLocal);
      log(`feed ${s.id}: ${items.length} items`);
      fetched.push(...items);
    } catch (e) {
      log(`feed ${s.id}: failed (${(e as Error).message})`);
    }
  }
  const weekday = new Date(`${date}T12:00:00Z`).getUTCDay();
  const maxAgeHours = weekday === 1 ? 80 : 40; // Monday covers the weekend
  const candidates = filterCandidates(fetched, { now, maxAgeHours, knownUrls }).slice(0, 60);
  log(`${candidates.length} fresh candidates`);

  const model = opts.model ?? createModel();
  const skipped: string[] = [];
  const written: RunResult["written"] = [];

  if (candidates.length) {
    // 3. Triage (cheap model, one call for all candidates)
    const catalog = `Town IDs: ${areas.towns.map((t) => t.id).join(", ")}`;
    const triage = await ask(model, { tier: "triage", system: triageSystem(catalog), prompt: triagePrompt(candidates), temperature: 0 }, TriageSchema);
    // Keep the pool varied: must-knows first, then statewide, regional, local, national.
    const order = { statewide: 1, regional: 2, local: 3, national: 4 } as const;
    const seenKeys = new Set<string>();
    const picks = triage.items
      .filter((t) => t.keep && candidates[t.i])
      .map((t) => ({ ...t, cities: t.cities.filter((c) => townIds.has(c)) }))
      .filter((t) => {
        if (!t.cities.length && t.significance !== "statewide" && t.significance !== "national") {
          skipped.push(`${candidates[t.i].title} (no known town)`);
          return false;
        }
        const k = t.storyKey || candidates[t.i].link;
        if (seenKeys.has(k)) return false;
        seenKeys.add(k);
        return true;
      })
      .sort((a, b) => (a.mustKnow ? 0 : order[a.significance]) - (b.mustKnow ? 0 : order[b.significance]))
      .slice(0, maxStories);
    for (const t of triage.items.filter((x) => !x.keep && candidates[x.i])) skipped.push(`${candidates[t.i].title} (${t.reason || "not kept"})`);

    // 4. Facts, draft, check
    const recentWriters = existing.map((s) => s.writerId as string);
    let previous: string | undefined;
    for (const t of picks) {
      const c = candidates[t.i];
      try {
        const facts = (await ask(model, { tier: "writer", system: FACTS_SYSTEM, prompt: factsPrompt(c), temperature: 0 }, z.any())) as Facts;
        if (!facts?.enough || !Array.isArray(facts.facts) || facts.facts.length < 3) {
          skipped.push(`${c.title} (too little in the source to write without guessing)`);
          continue;
        }
        const writer = pickWriter(writers, recentWriters, previous);
        const draft = await ask(model, { tier: "writer", system: writerSystem(writer), prompt: writerPrompt(c, facts), temperature: 0.6 }, DraftSchema);
        const body = tidy(draft.bodyMarkdown);
        const check = await ask(model, { tier: "triage", system: CHECK_SYSTEM, prompt: checkPrompt(facts, body), temperature: 0 }, CheckSchema);
        const flags = [...check.unsupported.map((u) => `Unsupported: ${u}`), ...check.styleIssues.map((s) => `Style: ${s}`)];
        const status = check.unsupported.length ? "draft" : "published";

        let slug = slugify(tidy(draft.headline));
        while (existingSlugs.has(slug)) slug = `${slug}-2`;
        existingSlugs.add(slug);
        const header = {
          id: `${date}-${slug}`.slice(0, 80),
          slug,
          headline: tidy(draft.headline).slice(0, 90),
          preview: tidy(draft.preview).slice(0, 220),
          writerId: writer.id,
          publishedAt: `${date}T06:00:00-05:00`,
          cities: t.cities,
          topics: t.topics.slice(0, 3).map(slugify).filter(Boolean),
          categories: [...new Set(t.categories)].slice(0, 2),
          tone: t.tone,
          mustKnow: t.mustKnow && t.significance !== "national",
          significance: t.significance,
          significanceReason: t.significanceReason || t.reason || "Triaged by the daily job.",
          image: { scene: draft.scene, alt: tidy(draft.imageAlt), credit: "Penpost illustration", rightsNote: "Owned illustration. No photo from the source was used.", illustrative: true },
          status,
          isDemo: false,
          sources: [{ url: c.link, publisher: c.sourceName, title: c.title, publishedAt: c.publishedAt.slice(0, 10), accessedAt: date }],
        };
        const file = join(storyDir, `${slug}.md`);
        writeFileSync(file, `---\n${JSON.stringify(header, null, 2)}\n---\n${body}\n`);
        written.push({ file: `content/stories/${slug}.md`, status, writer: writer.name, flags });
        recentWriters.push(writer.id);
        previous = writer.id;
        log(`${status === "draft" ? "HELD " : "ok   "} ${writer.name}: ${header.headline}`);
      } catch (e) {
        skipped.push(`${c.title} (error: ${(e as Error).message.slice(0, 120)})`);
      }
    }
  }

  // 5. Edition manifest: published stories only. Merge with an existing manifest for the date.
  const editionPath = join(root, "content", "editions", `${date}.json`);
  const newIds = written
    .filter((w) => w.status === "published")
    .map((w) => parseStoryFile(readFileSync(join(root, w.file), "utf8"), w.file).id);
  if (newIds.length) {
    const prior = existsSync(editionPath) ? (JSON.parse(readFileSync(editionPath, "utf8")) as { candidateStoryIds: string[] }) : null;
    const ids = [...new Set([...(prior?.candidateStoryIds ?? []), ...newIds])];
    writeFileSync(editionPath, JSON.stringify({ id: date, date, isDemo: false, candidateStoryIds: ids }, null, 2) + "\n");
  }

  const u = model.usage;
  const lines = [
    `## Proposed Penpost edition for ${date}`,
    "",
    written.length ? "| Status | Writer | File | Notes |\n| --- | --- | --- | --- |" : "No stories were drafted today.",
    ...written.map((w) => `| ${w.status === "draft" ? "Held for edits" : "Ready"} | ${w.writer} | \`${w.file}\` | ${w.flags.join("<br>") || ""} |`),
    "",
    "Stories marked **Held for edits** have statements the checker couldn't match to the source. They stay out of the edition until you fix them and change `status` to `published`.",
    "",
    `<details><summary>Skipped (${skipped.length})</summary>\n\n${skipped.map((s) => `- ${s}`).join("\n")}\n\n</details>`,
    "",
    `Model calls: ${u.calls}. Tokens in: ${u.inputTokens}. Tokens out: ${u.outputTokens}.`,
    "",
    "Merge to publish. Close without merging to skip today; the site keeps showing the last approved edition.",
  ];
  const summaryPath = join(outDir, "summary.md");
  writeFileSync(summaryPath, lines.join("\n") + "\n");
  writeFileSync(join(outDir, "has-changes"), written.length ? "true" : "false");
  log(`done: ${written.length} written, ${skipped.length} skipped, ${u.calls} model calls`);
  return { written, skipped, summaryPath };
}

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : undefined;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runPipeline({
    root: resolve(import.meta.dirname, ".."),
    date: arg("date"),
    feedsDir: arg("feeds-dir"),
    outDir: arg("out-dir"),
    maxStories: arg("max-stories") ? Number(arg("max-stories")) : undefined,
  }).catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
