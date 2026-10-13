import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = join(__dirname, "..");
const html = readFileSync(join(root, "index.html"), "utf8");
const meta = (attr: "property" | "name", key: string) => new RegExp(`<meta ${attr}="${key}" content="([^"]+)"`).exec(html)?.[1];

describe("link previews", () => {
  it("has the Open Graph and Twitter card tags, with an absolute image URL", () => {
    for (const k of ["og:title", "og:description", "og:url", "og:type", "og:image"]) expect(meta("property", k)).toBeTruthy();
    expect(meta("name", "twitter:card")).toBe("summary_large_image");
    expect(meta("property", "og:image")).toBe("https://penpost.co/og-image.png");
    expect(meta("property", "og:url")).toBe("https://penpost.co/");
  });

  it("ships a 1200x630 PNG share image at the site root", () => {
    const png = readFileSync(join(root, "public", "og-image.png"));
    expect(png.subarray(1, 4).toString()).toBe("PNG");
    expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([1200, 630]);
  });
});
