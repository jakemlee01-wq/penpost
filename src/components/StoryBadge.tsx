import type { Story } from "../lib/schema";

/**
 * A small line icon in the corner of each card photo that says what kind of story it is.
 * Same stroke style as the rest of the interface: one ink color, no emoji.
 */

type Kind =
  | "business" | "economy" | "agriculture" | "technology" | "politics" | "health" | "real-estate" | "food" | "culture"
  | "sports" | "football" | "basketball" | "hockey" | "baseball" | "soccer" | "golf" | "feel-good";

const LABELS: Record<Kind, string> = {
  business: "Business", economy: "Economy", agriculture: "Agriculture", technology: "Technology", politics: "Politics",
  health: "Health", "real-estate": "Real estate", food: "Food", culture: "Culture", sports: "Sports",
  football: "Football", basketball: "Basketball", hockey: "Hockey", baseball: "Baseball", soccer: "Soccer", golf: "Golf",
  "feel-good": "Feel-good story",
};

const SPORTS: [Kind, RegExp][] = [
  ["football", /\b(football|vikings|nfl)\b/],
  ["basketball", /\b(basketball|timberwolves|wolves|lynx|nba|wnba)\b/],
  ["hockey", /\b(hockey|wild|frost|nhl|pwhl)\b/],
  ["baseball", /\b(baseball|twins|saints|mlb|softball)\b/],
  ["soccer", /\b(soccer|loons|mls|minnesota-united)\b/],
  ["golf", /\b(golf|pga|lpga)\b/],
];

export function badgeKind(story: Pick<Story, "feelGood" | "categories" | "topics" | "headline">): Kind {
  if (story.feelGood) return "feel-good";
  const first = story.categories[0] ?? "business";
  if (first !== "sports") return first;
  const hay = `${story.topics.join(" ")} ${story.headline}`.toLowerCase();
  return SPORTS.find(([, re]) => re.test(hay))?.[0] ?? "sports";
}

const svg = { width: 18, height: 18, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, "aria-hidden": true };

const PATHS: Record<Kind, JSX.Element> = {
  business: (<><rect x="3" y="7" width="18" height="13" rx="2" /><path d="M9 7V5.5A1.5 1.5 0 0 1 10.5 4h3A1.5 1.5 0 0 1 15 5.5V7M3 13h18" /></>),
  economy: (<path d="M3 17l6-6 4 4 8-8M15 7h6v6" />),
  agriculture: (<path d="M12 21V8M12 8c-2.8 0-4-1.8-4-4.5 2.8 0 4 1.8 4 4.5ZM12 8c2.8 0 4-1.8 4-4.5-2.8 0-4 1.8-4 4.5ZM12 14c-2.8 0-4-1.8-4-4.5 2.8 0 4 1.8 4 4.5ZM12 14c2.8 0 4-1.8 4-4.5-2.8 0-4 1.8-4 4.5Z" />),
  technology: (<><rect x="4" y="5" width="16" height="11" rx="1.5" /><path d="M2 19h20" /></>),
  politics: (<path d="M3 21h18M4.5 10h15M12 3l8 5H4l8-5ZM6.5 10v8M10.2 10v8M13.8 10v8M17.5 10v8M4 18h16" />),
  health: (<><rect x="3.5" y="3.5" width="17" height="17" rx="4" /><path d="M12 8v8M8 12h8" /></>),
  "real-estate": (<path d="M3 11l9-7 9 7M5.5 9.5V20h13V9.5M10 20v-5.5h4V20" />),
  food: (<path d="M7 3v18M4.5 3v4.5a2.5 2.5 0 0 0 5 0V3M17.5 21V3c-2 1.2-3 4-3 8.5h3" />),
  culture: (<><path d="M12 3.5a8.5 8.5 0 1 0 0 17c1 0 1.5-.7 1.5-1.5 0-.8-.6-1.3-.6-2.1 0-.9.7-1.6 1.6-1.6h1.9a4.1 4.1 0 0 0 4.1-4.1C20.5 6.9 16.7 3.5 12 3.5Z" /><circle cx="7.8" cy="11" r="1" fill="currentColor" /><circle cx="10.5" cy="7.5" r="1" fill="currentColor" /><circle cx="15" cy="7.8" r="1" fill="currentColor" /></>),
  sports: (<path d="M8 4h8v5a4 4 0 0 1-8 0V4ZM8 6H5.5A2.5 2.5 0 0 0 8 9.5M16 6h2.5A2.5 2.5 0 0 1 16 9.5M12 13v4M9 20.5h6M10 17h4v3.5h-4z" />),
  football: (<><ellipse cx="12" cy="12" rx="9.5" ry="5.5" transform="rotate(-45 12 12)" /><path d="M9.5 14.5l5-5M10.5 11.5l2 2M12 10l2 2" /></>),
  basketball: (<><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3v18M5.6 5.6c3 3.2 3 9.6 0 12.8M18.4 5.6c-3 3.2-3 9.6 0 12.8" /></>),
  hockey: (<><path d="M14.5 3L8.6 17.6A2.3 2.3 0 0 1 6.5 19H3.5v-2.4h2.4L11.5 3" /><ellipse cx="17" cy="18.5" rx="3.5" ry="1.5" /></>),
  baseball: (<><circle cx="12" cy="12" r="9" /><path d="M6.6 5.2c1.9 1.8 2.9 4.2 2.9 6.8s-1 5-2.9 6.8M17.4 5.2c-1.9 1.8-2.9 4.2-2.9 6.8s1 5 2.9 6.8" /></>),
  soccer: (<><circle cx="12" cy="12" r="9" /><path d="M12 8.2l3.4 2.5-1.3 4h-4.2l-1.3-4L12 8.2ZM12 8.2V3M15.4 10.7l5-1.6M14.1 14.7l3 4.2M9.9 14.7l-3 4.2M8.6 10.7l-5-1.6" /></>),
  golf: (<path d="M8 21V3l9 3.5L8 10M5 21h8" />),
  "feel-good": (<><circle cx="12" cy="12" r="4" /><path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4" /></>),
};

export function StoryBadge({ story, className = "" }: { story: Pick<Story, "feelGood" | "categories" | "topics" | "headline">; className?: string }) {
  const kind = badgeKind(story);
  return (
    <span className={`story-badge${kind === "feel-good" ? " feel-good" : ""} ${className}`.trim()} role="img" aria-label={LABELS[kind]} title={LABELS[kind]}>
      <svg {...svg}>{PATHS[kind]}</svg>
    </span>
  );
}
