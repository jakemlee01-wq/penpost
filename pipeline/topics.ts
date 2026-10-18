/**
 * Per-day topic manifest for on-demand editions: content/topics/<date>.json.
 * Used by .github/workflows/draft-edition.yml:
 *
 *   npx tsx pipeline/topics.ts claim  --date D --topics a,b   mark topics pending (skips ready ones)
 *   npx tsx pipeline/topics.ts plan   --date D --topics a,b   print the topics this run should write
 *   npx tsx pipeline/topics.ts finish --date D                record pipeline/out/topic-results.json
 *
 * A blank --topics means every topic. Each command re-reads the manifest from disk, so the workflow
 * can re-run it after pulling the latest main without losing another run's changes.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { AreasSchema } from "../src/lib/areas";
import { chicagoDate } from "../src/lib/dates";
import { allTopicIds, claimTopics, finishTopics, parseManifest, planTopics, serializeManifest, type TopicManifest, type TopicResult } from "../src/lib/topics";

export function manifestPath(root: string, date: string): string {
  return join(root, "content", "topics", `${date}.json`);
}

export function readManifest(root: string, date: string): TopicManifest {
  const p = manifestPath(root, date);
  return parseManifest(existsSync(p) ? readFileSync(p, "utf8") : null, date);
}

export function writeManifest(root: string, m: TopicManifest): void {
  const p = manifestPath(root, m.date);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, serializeManifest(m));
}

export function knownTopics(root: string): string[] {
  const areas = AreasSchema.parse(JSON.parse(readFileSync(join(root, "content", "areas.json"), "utf8")));
  return allTopicIds(areas.regions);
}

/** Requested topic IDs, exact matches against the real list only. Blank means all. */
export function requestedTopics(root: string, raw: string | undefined): string[] {
  const known = knownTopics(root);
  const asked = (raw ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  return asked.length ? known.filter((id) => asked.includes(id)) : known;
}

export const RESULTS_FILE = join("pipeline", "out", "topic-results.json");

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : undefined;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const root = resolve(import.meta.dirname, "..");
  const cmd = process.argv[2];
  const date = arg("date") || chicagoDate();
  const now = new Date().toISOString();
  const manifest = readManifest(root, date);
  if (cmd === "claim") {
    const { manifest: next, claimed } = claimTopics(manifest, requestedTopics(root, arg("topics")), now);
    writeManifest(root, next);
    console.log(claimed.join(","));
  } else if (cmd === "plan") {
    console.log(planTopics(manifest, requestedTopics(root, arg("topics"))).join(","));
  } else if (cmd === "finish") {
    const p = join(root, RESULTS_FILE);
    if (!existsSync(p)) {
      console.error(`no ${RESULTS_FILE}; leaving the manifest as it is`);
    } else {
      writeManifest(root, finishTopics(manifest, JSON.parse(readFileSync(p, "utf8")) as Record<string, TopicResult>, now));
    }
  } else {
    console.error("usage: topics.ts claim|plan|finish --date YYYY-MM-DD [--topics a,b]");
    process.exit(2);
  }
}
