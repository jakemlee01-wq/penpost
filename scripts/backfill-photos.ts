/**
 * Adds Unsplash photos to published stories that only have an illustration.
 *
 *   npx tsx scripts/backfill-photos.ts [--date YYYY-MM-DD] [--limit 40]
 *
 * Needs UNSPLASH_ACCESS_KEY (and GEMINI_API_KEY to pick a search phrase per story).
 * Demo Unsplash keys allow 50 searches an hour, so the limit defaults to 40.
 */
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { chicagoDate } from "../src/lib/dates";
import { parseStoryFile } from "../src/lib/parse";
import { createModel } from "../pipeline/model";
import { findStockPhoto } from "../pipeline/photos";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : undefined;
}

const QUERY_SYSTEM = `You pick a stock photo search phrase for a news story. Reply with 2 to 4 plain words only, no punctuation.
The photo must fit the story without showing specific people or the actual event (for example "grain elevator", "hockey game", "pizza restaurant", "data center").`;

async function main() {
  const root = resolve(import.meta.dirname, "..");
  const date = arg("date") || chicagoDate(new Date());
  const limit = Number(arg("limit") || 40);
  const key = process.env.UNSPLASH_ACCESS_KEY;
  if (!key) throw new Error("UNSPLASH_ACCESS_KEY is not set");
  const model = createModel({ ...process.env, PENPOST_MAX_CALLS: "100" });
  const dir = join(root, "content", "stories");
  let added = 0;
  let missed = 0;
  for (const f of readdirSync(dir).filter((x) => x.endsWith(".md"))) {
    if (added + missed >= limit) break;
    const text = readFileSync(join(dir, f), "utf8");
    const story = parseStoryFile(text, f);
    if (!story.publishedAt.startsWith(date) || story.status !== "published" || !story.image?.illustrative) continue;
    const query = (await model.complete({ tier: "triage", system: QUERY_SYSTEM, prompt: `${story.headline}\n${story.preview}`, temperature: 0 }))
      .replace(/[^a-zA-Z0-9 ]/g, " ")
      .trim()
      .split(/\s+/)
      .slice(0, 4)
      .join(" ");
    const found = await findStockPhoto(query, key).catch(() => null);
    if (!found) {
      missed++;
      console.log(`no photo  ${f} ("${query}")`);
      continue;
    }
    const [, header, ...rest] = text.split("---\n");
    const h = JSON.parse(header);
    h.image = { photo: found.photo, scene: h.image.scene, alt: found.alt, credit: found.photo.credit, rightsNote: "Unsplash License. Hotlinked per Unsplash API guidelines.", illustrative: false };
    const next = `---\n${JSON.stringify(h, null, 2)}\n---\n${rest.join("---\n")}`;
    parseStoryFile(next, f); // must still be a valid story
    writeFileSync(join(dir, f), next);
    added++;
    console.log(`photo     ${f} ("${query}") ${found.photo.credit}`);
  }
  const summary = `${added} photos added, ${missed} not found, for ${date}`;
  console.log(summary);
  if (process.env.GITHUB_ACTIONS === "true") console.log(`::notice title=Photo backfill::${summary}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
