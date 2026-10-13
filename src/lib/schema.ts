import { z } from "zod";

export const WRITER_IDS = ["emma", "jack", "grace", "luke", "ben"] as const;
export const CATEGORY_IDS = ["business", "economy", "agriculture", "technology", "sports", "politics", "health", "real-estate", "food", "culture"] as const;
export const SCOPES = ["local", "minnesota", "national"] as const;
export type CategoryId = (typeof CATEGORY_IDS)[number];
export type Scope = (typeof SCOPES)[number];

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

/**
 * A real photo for the story. Order of preference: the company's own media photo,
 * a public or openly licensed photo of the real place, then a generic stock photo.
 * kind "stock" is always captioned "Stock photo" so it never implies it shows the event.
 */
export const StoryPhotoSchema = z.object({
  kind: z.enum(["press", "place", "stock"]),
  caption: z.string().min(3), // what the photo shows, e.g. "U.S. Bank Stadium, Minneapolis"
  credit: z.string().min(3), // e.g. "Joe Caper / Unsplash"
  license: z.string().min(3), // e.g. "Unsplash License"
  pageUrl: z.string().url(), // where the license and credit can be checked
  downloadUrl: z.string().url().optional(), // fetched into the site at build time
  hotlinkUrl: z.string().url().optional(), // used directly when the source requires hotlinking
  photographer: z.string().optional(), // Unsplash: photographer name for "Photo by X on Unsplash"
  photographerUrl: z.string().url().optional(), // Unsplash: photographer profile link
});
export type StoryPhoto = z.infer<typeof StoryPhotoSchema>;

export const StoryImageSchema = z.object({
  photo: StoryPhotoSchema.optional(),
  // Illustration used when no photo is available (or until it's downloaded).
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
  significance: z.enum(["local", "regional", "statewide", "national"]),
  // Broad sections readers pick as interests. Most stories have one; a few fit two.
  categories: z.array(z.enum(CATEGORY_IDS)).min(1).max(3).default(["business"]),
  // For the "lighter vs everything" dial. Selection only; it never changes how a story is written.
  tone: z.enum(["light", "neutral", "heavy"]).default("neutral"),
  // Big news for its places that should reach readers regardless of their interests or mood.
  mustKnow: z.boolean().default(false),
  // A story that makes you feel good about the world. Every reader gets one a day as a bonus last card.
  feelGood: z.boolean().default(false),
  significanceReason: z.string().min(5),
  sources: z.array(SourceSchema).min(1),
  image: StoryImageSchema.optional(),
  status: z.enum(["draft", "reviewed", "published"]),
  isDemo: z.boolean(),
  correctionNote: z.string().optional(),
}).refine((s) => s.significance === "statewide" || s.significance === "national" || s.cities.length > 0, { message: "local and regional stories need at least one town", path: ["cities"] });

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

export type Interest = { category: CategoryId; scope: Scope };

export type SetupRecord = {
  /** What the reader typed or said at setup, kept so they can redo it from Settings. */
  text: string;
  /** ai = parsed by the Worker, basic = parsed in the browser, starter = nothing usable, manual = set in Settings */
  source: "ai" | "basic" | "starter" | "manual";
  at: string;
};

export type ReaderPreferences = {
  /** Picked areas, e.g. "region:twin-cities", "county:lac-qui-parle", "town:dawson". Empty = statewide and national only. */
  areas: string[];
  /** Sections with how wide to look. */
  interests: Interest[];
  /** Free-form things to favor ("value investing", "berkshire hathaway"). A small nudge. */
  likes: string[];
  /** Explicit dislikes ("soccer"). A small down-weight, never a filter. */
  avoids: string[];
  /** Writers the reader likes; a small nudge, never a filter. Settings only. */
  favoriteWriters: string[];
  /** Present once the reader has finished setup. */
  setup: SetupRecord | null;
};
