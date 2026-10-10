/**
 * Downloads each story's licensed photo into src/assets/photos/<story id>.jpg so the
 * site serves it itself. Runs on GitHub before every build. Already-downloaded photos
 * are skipped. A failed download never fails the build: that story keeps its illustration.
 *
 *   npx tsx scripts/fetch-photos.ts
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseStoryFile } from "../src/lib/parse";

const root = join(import.meta.dirname, "..");
const storyDir = join(root, "content", "stories");
const outDir = join(root, "src", "assets", "photos");
mkdirSync(outDir, { recursive: true });

const MAX_BYTES = 1_500_000;
let ok = 0;
let skipped = 0;
let failed = 0;

for (const file of readdirSync(storyDir).filter((f) => f.endsWith(".md"))) {
  const story = parseStoryFile(readFileSync(join(storyDir, file), "utf8"), file);
  const url = story.image?.photo?.downloadUrl;
  if (!url) continue;
  const target = join(outDir, `${story.id}.jpg`);
  if (existsSync(target)) {
    skipped++;
    continue;
  }
  try {
    const res = await fetch(url, { redirect: "follow", headers: { "user-agent": "PenpostBuild/0.1 (+https://penpost.co)" } });
    const type = res.headers.get("content-type") ?? "";
    if (!res.ok || !type.startsWith("image/")) throw new Error(`HTTP ${res.status} ${type}`);
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > MAX_BYTES * 4) throw new Error(`too large (${buf.length} bytes); use a smaller size in downloadUrl`);
    writeFileSync(target, buf);
    ok++;
    console.log(`photo ${story.id}: ${Math.round(buf.length / 1024)} KB`);
  } catch (e) {
    failed++;
    console.warn(`photo ${story.id}: kept illustration (${(e as Error).message})`);
  }
}
console.log(`photos: ${ok} downloaded, ${skipped} already present, ${failed} failed`);
