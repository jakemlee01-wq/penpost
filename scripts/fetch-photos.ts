/**
 * Runs on GitHub before every build.
 * 1. Tries to download each story's photo (downloadUrl) into src/assets/photos/<story id>.jpg.
 * 2. Checks that each hotlinked photo (hotlinkUrl) actually loads.
 * 3. Writes public/photo-check.json, published with the site, so anyone can see which photos work.
 * A failure never fails the build: the story falls back to its hotlink, then to its illustration.
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
mkdirSync(join(root, "public"), { recursive: true });

const UA = { "user-agent": "Mozilla/5.0 (compatible; PenpostBuild/0.1; +https://penpost.co)" };
const report: Record<string, { download: string; hotlink: string }> = {};

async function probe(url: string): Promise<string> {
  try {
    const res = await fetch(url, { redirect: "follow", headers: UA });
    const type = res.headers.get("content-type") ?? "";
    return res.ok && type.startsWith("image/") ? "ok" : `HTTP ${res.status} ${type}`;
  } catch (e) {
    return `error ${(e as Error).message}`;
  }
}

for (const file of readdirSync(storyDir).filter((f) => f.endsWith(".md"))) {
  const story = parseStoryFile(readFileSync(join(storyDir, file), "utf8"), file);
  const photo = story.image?.photo;
  if (!photo) continue;
  const entry = { download: "none", hotlink: "none" };

  if (photo.downloadUrl) {
    const target = join(outDir, `${story.id}.jpg`);
    if (existsSync(target)) entry.download = "present";
    else {
      try {
        const res = await fetch(photo.downloadUrl, { redirect: "follow", headers: UA });
        const type = res.headers.get("content-type") ?? "";
        if (!res.ok || !type.startsWith("image/")) throw new Error(`HTTP ${res.status} ${type}`);
        writeFileSync(target, Buffer.from(await res.arrayBuffer()));
        entry.download = "ok";
      } catch (e) {
        entry.download = `failed ${(e as Error).message}`;
      }
    }
  }
  if (photo.hotlinkUrl) entry.hotlink = await probe(photo.hotlinkUrl);
  report[story.id] = entry;
  console.log(`photo ${story.id}: download=${entry.download} hotlink=${entry.hotlink}`);
}

writeFileSync(join(root, "public", "photo-check.json"), JSON.stringify({ checkedAt: new Date().toISOString(), photos: report }, null, 2));
