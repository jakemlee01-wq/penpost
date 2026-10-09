import { XMLParser } from "fast-xml-parser";

export type Source = { id: string; name: string; url: string; enabled: boolean; fullTextAllowed: boolean; kind: "news" | "primary" };
export type Candidate = {
  sourceId: string;
  sourceName: string;
  title: string;
  link: string;
  publishedAt: string; // ISO
  summary: string;
  fullText?: string; // only when the source allows it
};

const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@_", textNodeName: "#text" });

export function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#8217;|&rsquo;/g, "'")
    .replace(/&#8220;|&#8221;|&ldquo;|&rdquo;|&quot;/g, '"')
    .replace(/&#\d+;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const text = (v: unknown): string => {
  if (v == null) return "";
  if (typeof v === "string") return v;
  if (typeof v === "object" && "#text" in (v as object)) return String((v as { "#text": unknown })["#text"]);
  return String(v);
};

/** Parse RSS 2.0 or Atom into candidates. */
export function parseFeed(xml: string, source: Source): Candidate[] {
  const doc = parser.parse(xml);
  const rssItems = doc?.rss?.channel?.item;
  const atomItems = doc?.feed?.entry;
  const items: unknown[] = Array.isArray(rssItems) ? rssItems : rssItems ? [rssItems] : Array.isArray(atomItems) ? atomItems : atomItems ? [atomItems] : [];
  return items
    .map((raw) => {
      const it = raw as Record<string, unknown>;
      const link = typeof it.link === "object" && it.link && "@_href" in (it.link as object) ? String((it.link as { "@_href": string })["@_href"]) : text(it.link);
      const date = text(it.pubDate ?? it.published ?? it.updated);
      const summary = stripHtml(text(it.description ?? it.summary)).slice(0, 1200);
      const body = stripHtml(text(it["content:encoded"] ?? it.content));
      return {
        sourceId: source.id,
        sourceName: source.name,
        title: stripHtml(text(it.title)),
        link: link.trim(),
        publishedAt: date ? new Date(date).toISOString() : "",
        summary,
        fullText: source.fullTextAllowed && body ? body.slice(0, 12000) : undefined,
      };
    })
    .filter((c) => c.title && /^https?:\/\//.test(c.link) && c.publishedAt);
}

export async function fetchSource(source: Source, readLocal?: (s: Source) => Promise<string | null>): Promise<Candidate[]> {
  const xml = readLocal ? await readLocal(source) : await fetch(source.url, { headers: { "user-agent": "PenpostBot/0.1 (+https://penpost.co)" } }).then((r) => (r.ok ? r.text() : null));
  if (!xml) return [];
  return parseFeed(xml, source);
}

/** Keep fresh items we haven't already published, dropping exact duplicate links. */
export function filterCandidates(all: Candidate[], opts: { now: Date; maxAgeHours: number; knownUrls: Set<string> }): Candidate[] {
  const cutoff = opts.now.getTime() - opts.maxAgeHours * 3600_000;
  const seen = new Set<string>();
  return all
    .filter((c) => new Date(c.publishedAt).getTime() >= cutoff)
    .filter((c) => !opts.knownUrls.has(c.link))
    .filter((c) => (seen.has(c.link) ? false : (seen.add(c.link), true)))
    .sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));
}
