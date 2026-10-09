import writersJson from "../../content/writers/writers.json";
import townsJson from "../../content/towns.json";
import { parseStoryFile } from "./parse";
import { EditionManifestSchema, TownSchema, WriterSchema, type EditionManifest, type Story, type Town, type Writer } from "./schema";

const storyFiles = import.meta.glob("../../content/stories/*.md", { query: "?raw", import: "default", eager: true }) as Record<string, string>;
const editionFiles = import.meta.glob("../../content/editions/*.json", { import: "default", eager: true }) as Record<string, unknown>;
const avatarFiles = import.meta.glob("../assets/avatars/*.{png,jpg,webp}", { import: "default", eager: true }) as Record<string, string>;

export const writers: Writer[] = WriterSchema.array().parse(writersJson);
export const towns: Town[] = TownSchema.array().parse(townsJson);

export const stories: Story[] = Object.entries(storyFiles)
  .map(([path, raw]) => parseStoryFile(raw, path.split("/").pop()))
  // Drafts never reach the reader bundle's lists.
  .filter((s) => s.status !== "draft");

export const editions: EditionManifest[] = Object.values(editionFiles).map((e) => EditionManifestSchema.parse(e));

export const storyById = new Map(stories.map((s) => [s.id, s]));
export const storyBySlug = new Map(stories.map((s) => [s.slug, s]));
export const writerById = new Map<string, Writer>(writers.map((w) => [w.id, w]));
export const townById = new Map(towns.map((t) => [t.id, t]));

export function avatarUrl(writer: Writer): string {
  const hit = Object.entries(avatarFiles).find(([p]) => p.endsWith(`/${writer.avatar}`));
  return hit ? hit[1] : "";
}

export function townNames(ids: string[]): string {
  return ids.map((id) => townById.get(id)?.name ?? id).join(" + ");
}

export const TOPIC_LABELS: Record<string, string> = {
  "small-business": "Small business",
  openings: "Openings",
  startups: "Startups",
  "venture-capital": "Venture capital",
  "private-equity": "Private equity",
  acquisitions: "Acquisitions",
  "main-street": "Main street",
  agriculture: "Agriculture",
  expansions: "Expansions",
  manufacturing: "Manufacturing",
  jobs: "Jobs",
  innovation: "Innovation",
  financing: "Financing",
  logistics: "Logistics",
};
