// @vitest-environment node
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = join(__dirname, "..");

function walk(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

const hubFiles = [...walk(join(root, "hub")), ...walk(join(root, "tests")).filter((f) => /hub/i.test(f))].filter((f) => /\.(ts|toml|md|js|json|html|css)$/.test(f));

describe("hub keeps secrets and private data out of the repo and the news build", () => {
  it("found the hub files to scan", () => {
    expect(hubFiles.length).toBeGreaterThan(5);
  });

  it("uses only placeholder emails", () => {
    for (const f of hubFiles) {
      const emails = readFileSync(f, "utf8").match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g) ?? [];
      for (const e of emails) expect(e, `${f}: ${e}`).toMatch(/@(example\.com|anthropic\.com)$/);
    }
  });

  it("contains no credential-looking strings or real data hosts", () => {
    const patterns = [
      /eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}/, // a committed JWT
      /\bsk-[A-Za-z0-9]{16,}/,
      /AIza[0-9A-Za-z_-]{30,}/,
      /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
      /[a-z0-9]{20}\.supabase\.co/,
      /service_role/i,
    ];
    for (const f of hubFiles.filter((x) => !x.endsWith("hub-no-leak.test.ts"))) {
      const text = readFileSync(f, "utf8");
      for (const p of patterns) expect(p.test(text), `${f} matches ${p}`).toBe(false);
    }
  });

  it("fixture links point only at example.com", () => {
    const text = readFileSync(join(root, "hub/src/fixtures.ts"), "utf8");
    for (const u of text.match(/https?:\/\/[^\s"'`)]+/g) ?? []) expect(u).toMatch(/^https:\/\/example\.com\//);
  });

  it("is not part of the GitHub Pages build", () => {
    expect(existsSync(join(root, "public/hub"))).toBe(false);
    for (const f of walk(join(root, "src"))) expect(readFileSync(f, "utf8"), f).not.toMatch(/hub\/src|from ["'][./]*hub\//);
    // If a news build exists locally, it must not contain hub code.
    for (const f of walk(join(root, "dist")).filter((p) => /\.(html|js|css)$/.test(p))) {
      const t = readFileSync(f, "utf8");
      expect(t.includes("What needs me next?"), f).toBe(false);
      expect(t.includes("cf-access-jwt-assertion"), f).toBe(false);
    }
  });

  it("wrangler config disables workers.dev and preview URLs and holds no secrets", () => {
    const toml = readFileSync(join(root, "hub/wrangler.toml"), "utf8");
    expect(toml).toMatch(/^workers_dev = false$/m);
    expect(toml).toMatch(/^preview_urls = false$/m);
    expect(toml).not.toMatch(/^\s*(ACCESS_AUD|ALLOWED_EMAILS|ACCESS_TEAM_DOMAIN)\s*=/m);
  });
});
