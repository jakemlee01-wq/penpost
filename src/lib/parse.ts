import { StoryMetaSchema, type Story } from "./schema";

/** Story files are Markdown with a JSON header between two `---` lines. */
export function parseStoryFile(raw: string, fileName = "story"): Story {
  const match = raw.match(/^---\s*\n([\s\S]*?)\n---\s*\n([\s\S]*)$/);
  if (!match) throw new Error(`${fileName}: missing JSON header block`);
  let header: unknown;
  try {
    header = JSON.parse(match[1]);
  } catch (e) {
    throw new Error(`${fileName}: header is not valid JSON (${(e as Error).message})`);
  }
  const parsed = StoryMetaSchema.safeParse(header);
  if (!parsed.success) {
    throw new Error(`${fileName}: ${parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`);
  }
  const bodyMarkdown = match[2].trim();
  const wordCount = countWords(bodyMarkdown);
  return {
    ...parsed.data,
    bodyMarkdown,
    wordCount,
    estimatedReadMinutes: Math.max(0.5, Math.round((wordCount / 220) * 2) / 2),
  };
}

export function countWords(md: string): number {
  return md
    .replace(/[#>*_`[\]()]/g, " ")
    .split(/\s+/)
    .filter(Boolean).length;
}
