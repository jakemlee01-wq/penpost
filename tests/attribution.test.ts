import { describe, expect, it } from "vitest";
import { findStockPhoto } from "../pipeline/photos";

describe("Unsplash attribution", () => {
  it("records the photographer and profile link, and pings the download endpoint", async () => {
    const calls: string[] = [];
    const fake = (async (url: string) => {
      calls.push(String(url));
      if (String(url).includes("/search/photos")) {
        return new Response(
          JSON.stringify({
            results: [
              {
                alt_description: "a pizza on a table",
                urls: { regular: "https://images.unsplash.com/photo-1?w=1080" },
                links: { html: "https://unsplash.com/photos/abc", download_location: "https://api.unsplash.com/photos/abc/download" },
                user: { name: "Ana Lee", links: { html: "https://unsplash.com/@analee" } },
              },
            ],
          }),
          { status: 200 },
        );
      }
      return new Response("{}", { status: 200 });
    }) as unknown as typeof fetch;
    const found = await findStockPhoto("pizza restaurant", "key", fake);
    expect(found?.photo.photographer).toBe("Ana Lee");
    expect(found?.photo.photographerUrl).toBe("https://unsplash.com/@analee?utm_source=penpost&utm_medium=referral");
    expect(found?.photo.hotlinkUrl).toContain("images.unsplash.com");
    expect(calls.some((c) => c.startsWith("https://api.unsplash.com/photos/abc/download"))).toBe(true);
  });
});
