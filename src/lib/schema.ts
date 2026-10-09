import { z } from "zod";

export const WRITER_IDS = ["emma", "jack", "grace", "luke", "ben"] as const;

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "expected YYYY-MM-DD");
const isoTimestampWithOffset = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?([+-]\d{2}:\d{2}|Z)$/, "expected ISO timestamp with offset");

export const SourceSchema = z.object({
  url: z.string().url().refine((u) => /^https?:\/\//.test(u), "source URLs must be http(s)"),
  publisher: z.string().min(1),
  title: z.string().min(1),
  publishedAt: isoDate.optional(),
  accessedAt: isoDate,
});

export const StoryImageSchema = z.object({
  scene: z.enum(["cafe", "office", "van", "mainstreet", "farm", "factory", "industrial", "road"]),
  alt: z.string().min(10),
  credit: z.string().min(1),
  rightsNote: z.string().min(1),
  illustrative: z.boolean(),
});

export const StoryMetaSchema = z.object({
  id: z.string().min(1),
  slug: z.string().regex(/^[a-z0-9-]+$/),
  headline: z.string().min(5).max(90),
  preview: z.string().min(10).max(220),
  writerId: z.enum(WRITER_IDS),
  publishedAt: isoTimestampWithOffset,
  updatedAt: isoTimestampWithOffset.optional(),
  // Towns the story is about. Statewide stories with no single place may leave this empty.
  cities: z.array(z.string()),
  topics: z.array(z.string()).min(1),
  significance: z.enum(["local", "regional", "statewide"]),
  significanceReason: z.string().min(5),
  sources: z.array(SourceSchema).min(1),
  image: StoryImageSchema.optional(),
  status: z.enum(["draft", "reviewed", "published"]),
  isDemo: z.boolean(),
  correctionNote: z.string().optional(),
}).refine((s) => s.significance === "statewide" || s.cities.length > 0, { message: "local and regional stories need at least one town", path: ["cities"] });

export type Source = z.infer<typeof SourceSchema>;
export type StoryMeta = z.infer<typeof StoryMetaSchema>;
export type Story = StoryMeta & {
  bodyMarkdown: string;
  wordCount: number;
  estimatedReadMinutes: number;
};

export const WriterSchema = z.object({
  id: z.enum(WRITER_IDS),
  name: z.string().min(1),
  isAI: z.literal(true),
  pronouns: z.enum(["she/her", "he/him"]),
  avatar: z.string().regex(/^[a-z]+\.(png|jpg|webp)$/),
  tagline: z.string(),
  bio: z.string().regex(/AI/, "bio must disclose AI"),
  personality: z.string(),
  background: z.string(),
  tone: z.array(z.string()).min(1),
  writingStyle: z.string(),
  strengths: z.array(z.string()).min(1),
  potentialBias: z.array(z.string()).min(1),
  exampleVoice: z.string(),
  beats: z.array(z.string()),
  // Internal drafting configuration. Shown nowhere in the reader UI.
  styleInstructions: z.string(),
});
export type Writer = z.infer<typeof WriterSchema>;

export const TownSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/),
  name: z.string(),
  region: z.string(),
});
export type Town = z.infer<typeof TownSchema>;

export const EditionManifestSchema = z.object({
  id: z.string(),
  date: isoDate,
  isDemo: z.boolean(),
  candidateStoryIds: z.array(z.string()).min(1),
});
export type EditionManifest = z.infer<typeof EditionManifestSchema>;

export type Edition = {
  id: string;
  date: string;
  label: string;
  storyIds: string[];
  estimatedTotalReadMinutes: number;
  isDemo: boolean;
};

export type Vote = "up" | "down";

export type Feedback = {
  storyId: string;
  editionId: string;
  writerId: string;
  topics: string[];
  towns: string[];
  vote: Vote | null;
  votedAt?: string;
};

export type ReaderPreferences = {
  /** Picked areas, e.g. "region:twin-cities", "county:lac-qui-parle", "town:dawson". Empty until the reader chooses. */
  areas: string[];
  explicitTopics: string[];
  explicitWriters: string[];
};
