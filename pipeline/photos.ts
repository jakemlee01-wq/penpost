/**
 * Finds a licensed photo for a drafted story. Optional: runs only when UNSPLASH_ACCESS_KEY is set
 * (free key from unsplash.com/developers). Results are always generic, so they're stored as
 * kind "stock" and captioned "Stock photo". Per Unsplash's API rules, API photos are hotlinked
 * (not re-hosted) and the photo's download endpoint is pinged when it's used.
 *
 * Company press photos and public-domain photos of the real place are better, but they need a
 * rights check, so for now those are added by hand during review.
 */
import type { StoryPhoto } from "../src/lib/schema";

type UnsplashResult = {
  alt_description?: string | null;
  description?: string | null;
  premium?: boolean;
  plus?: boolean;
  urls: { regular: string };
  links: { html: string; download_location: string };
  user: { name: string };
};

export async function findStockPhoto(
  query: string,
  key: string | undefined,
  fetchImpl: typeof fetch = fetch,
): Promise<{ photo: StoryPhoto; alt: string } | null> {
  if (!key || !query.trim()) return null;
  const url = `https://api.unsplash.com/search/photos?query=${encodeURIComponent(query)}&orientation=landscape&content_filter=high&per_page=5`;
  const res = await fetchImpl(url, { headers: { Authorization: `Client-ID ${key}`, "Accept-Version": "v1" } });
  if (!res.ok) return null;
  const data = (await res.json()) as { results?: UnsplashResult[] };
  const hit = data.results?.find((r) => !r.premium && !r.plus);
  if (!hit) return null;
  // Required by Unsplash API guidelines when a photo is used.
  await fetchImpl(`${hit.links.download_location}${hit.links.download_location.includes("?") ? "&" : "?"}client_id=${encodeURIComponent(key)}`).catch(() => null);
  const what = (hit.alt_description || hit.description || query).replace(/\.$/, "");
  return {
    alt: what.charAt(0).toUpperCase() + what.slice(1),
    photo: {
      kind: "stock",
      caption: `Stock photo: ${what}`,
      credit: `${hit.user.name} / Unsplash`,
      license: "Unsplash License",
      pageUrl: `${hit.links.html}?utm_source=penpost&utm_medium=referral`,
      hotlinkUrl: `${hit.urls.regular}`,
    },
  };
}
