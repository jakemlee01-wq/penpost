/**
 * Local preview and measurements for the hub, synthetic data only.
 *
 *   npx tsx hub/scripts/preview.ts <outDir> [chromePath]
 *
 * Runs the real Worker handler behind a local HTTP server, with a throwaway signing key standing in
 * for Cloudflare Access, then uses Chrome to take screenshots and measure. This does NOT exercise
 * real Cloudflare Access, its cookies, other hostnames or Cloudflare's cache. Nothing is deployed.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { join } from "node:path";
import { chromium, type Page } from "playwright-core";
import { handle, type HubEnv } from "../src/worker";
import { AUD, OWNER, TEAM, certsFetch, makeKey, sign } from "../../tests/hubHelpers";

const outDir = process.argv[2] ?? "hub-preview";
const chromePath = process.argv[3] ?? "/usr/bin/google-chrome";
mkdirSync(outDir, { recursive: true });

const SIZES = {
  "phone-320": { width: 320, height: 640, mobile: true },
  "phone-390": { width: 390, height: 844, mobile: true },
  "desktop-1280": { width: 1280, height: 900, mobile: false },
} as const;
type Size = keyof typeof SIZES;

async function main() {
  const key = await makeKey("preview");
  const { f } = certsFetch([key]);
  const t = Math.floor(Date.now() / 1000);
  const token = await sign(key, { iss: `https://${TEAM}`, aud: [AUD], email: OWNER, type: "app", iat: t, nbf: t, exp: t + 3600 });
  const otherToken = await sign(key, { iss: `https://${TEAM}`, aud: [AUD], email: "someone.else@example.com", type: "app", iat: t, nbf: t, exp: t + 3600 });
  const serverTimes: number[] = [];

  const server = createServer(async (nreq, nres) => {
    const headers = new Headers();
    for (const [k, v] of Object.entries(nreq.headers)) if (typeof v === "string") headers.set(k, v);
    const env: HubEnv = { ACCESS_TEAM_DOMAIN: TEAM, ACCESS_AUD: AUD, ALLOWED_EMAILS: OWNER, HUB_DATA_MODE: "fixture", HUB_FIXTURE: headers.get("x-fixture") ?? "normal" };
    if (headers.get("x-certs-down")) env.ACCESS_TEAM_DOMAIN = "down.cloudflareaccess.com";
    const t0 = performance.now();
    const res = await handle(new Request(`http://localhost${nreq.url}`, { method: nreq.method, headers }), env, {
      fetchImpl: headers.get("x-certs-down") ? (async () => { throw new Error("down"); }) as unknown as typeof fetch : f,
      certCache: {},
    });
    if (nreq.url === "/") serverTimes.push(performance.now() - t0);
    nres.writeHead(res.status, Object.fromEntries(res.headers));
    nres.end(Buffer.from(await res.arrayBuffer()));
  });
  await new Promise<void>((r) => server.listen(0, r));
  const base = `http://localhost:${(server.address() as { port: number }).port}`;
  const browser = await chromium.launch({ executablePath: chromePath, args: ["--no-sandbox"] });
  const report: Record<string, unknown> = {};

  let lastStatus = 0;
  async function shot(name: string, path: string, size: Size, headers: Record<string, string>, full = true): Promise<Page> {
    const s = SIZES[size];
    const ctx = await browser.newContext({ viewport: { width: s.width, height: s.height }, isMobile: s.mobile, hasTouch: s.mobile, deviceScaleFactor: 2, extraHTTPHeaders: headers });
    const page = await ctx.newPage();
    lastStatus = (await page.goto(base + path))?.status() ?? 0;
    await page.screenshot({ path: join(outDir, `${name}-${size}.png`), fullPage: full });
    return page;
  }
  const auth = (fixture: string) => ({ "cf-access-jwt-assertion": token, "x-fixture": fixture });

  // Glance surface.
  const scroll: Record<string, boolean> = {};
  for (const size of Object.keys(SIZES) as Size[]) {
    for (const fx of ["normal", "partial"]) {
      const p = await shot(`glance-${fx}`, "/", size, auth(fx));
      scroll[`${fx}-${size}`] = await p.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
      await p.context().close();
    }
  }
  for (const fx of ["empty", "stale", "missing_write", "outage", "not_connected"]) await (await shot(`glance-${fx}`, "/", "phone-390", auth(fx))).context().close();
  // One tap behind.
  for (const size of ["phone-320", "phone-390"] as Size[]) {
    const p = await shot("domain-money", "/d/money", size, auth("normal"));
    scroll[`domain-money-${size}`] = await p.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
    await p.context().close();
  }
  await (await shot("task-list", "/d/today", "phone-390", auth("normal"))).context().close();
  report.horizontalScroll = scroll;

  // Error pages: signed out at all sizes, plus wrong account and sign-in check down. Check they are styled.
  const errorStyles: Record<string, unknown> = {};
  const errorCases: [string, Record<string, string>, Size[]][] = [
    ["signed-out", {}, ["phone-320", "phone-390", "desktop-1280"]],
    ["wrong-account", { "cf-access-jwt-assertion": otherToken }, ["phone-390"]],
    ["auth-down", { "cf-access-jwt-assertion": token, "x-certs-down": "1" }, ["phone-390"]],
  ];
  for (const [name, headers, sizes] of errorCases) {
    for (const size of sizes) {
      const p = await shot(name, "/", size, headers, false);
      const status = lastStatus;
      errorStyles[`${name}-${size}`] = { status, ...(await p.evaluate(() => {
        const b = getComputedStyle(document.body);
        const btn = document.querySelector(".button");
        return {
          stylesheetLoaded: document.styleSheets.length > 0 && document.styleSheets[0].cssRules.length > 0,
          bodyBackground: b.backgroundColor,
          fontIsSerifDefault: /times/i.test(b.fontFamily),
          buttonBackground: btn ? getComputedStyle(btn).backgroundColor : null,
          bodyText: document.body.innerText.replace(/\s+/g, " ").trim(),
        };
      })) };
      await p.context().close();
    }
  }
  report.errorPages = errorStyles;

  // Phone measurements on the normal glance.
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, permissions: ["clipboard-read", "clipboard-write"], extraHTTPHeaders: auth("normal") });
  // tsx keeps function names via a __name helper that does not exist inside the page.
  await ctx.addInitScript("window.__name = function (f) { return f; };");
  const page = await ctx.newPage();
  const navMs = () => page.evaluate(() => { const n = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming; return n.loadEventEnd - n.startTime; });
  const loads: number[] = [];
  for (let i = 0; i < 10; i++) { await page.goto(base + "/", { waitUntil: "load" }); loads.push(await navMs()); }
  loads.sort((a, b) => a - b);
  report.localLoadMs = { median: Math.round(loads[5]), max: Math.round(loads[9]), runs: 10 };
  report.serverRenderMs = { median: Number(serverTimes.sort((a, b) => a - b)[Math.floor(serverTimes.length / 2)].toFixed(2)) };
  report.glanceBytes = await page.evaluate(async () => (await (await fetch("/")).text()).length + (await (await fetch("/hub.css")).text()).length);

  const cdp = await ctx.newCDPSession(page);
  await cdp.send("Network.emulateNetworkConditions", { offline: false, latency: 150, downloadThroughput: (1.6 * 1024 * 1024) / 8, uploadThroughput: (750 * 1024) / 8 });
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
  const slow: number[] = [];
  for (let i = 0; i < 5; i++) { await page.goto(base + "/", { waitUntil: "load" }); slow.push(await navMs()); }
  slow.sort((a, b) => a - b);
  report.throttledLoadMs = { median: Math.round(slow[2]), max: Math.round(slow[4]), runs: 5, note: "150 ms latency, 1.6 Mbps down, 4x CPU slowdown, local server; excludes real Cloudflare and the Access sign-in redirect" };
  await cdp.send("Network.emulateNetworkConditions", { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: 1 });
  await page.goto(base + "/");

  report.glanceLayout = await page.evaluate(() => {
    const vh = window.innerHeight;
    const top = (sel: string) => Math.round(document.querySelector(sel)!.getBoundingClientRect().top);
    const cards = [...document.querySelectorAll(".card")].map((c) => c.getBoundingClientRect());
    return {
      viewportHeight: vh,
      nextThingTop: top(".next-label"),
      firstCardTop: Math.round(cards[0].top),
      cardsFullyInFirstScreen: cards.filter((r) => r.bottom <= vh).length,
      buttonsOnGlance: document.querySelectorAll("button").length,
      nextThingCount: document.querySelectorAll(".next-label").length,
    };
  });

  const smallTargets = async () =>
    page.evaluate(() =>
      [...document.querySelectorAll("a, button, summary")]
        .map((e) => ({ text: (e.textContent ?? "").trim().slice(0, 30), h: Math.round(e.getBoundingClientRect().height), w: Math.round(e.getBoundingClientRect().width) }))
        .filter((r) => r.h > 0 && (r.h < 44 || r.w < 44)),
    );
  const tabOrder = async (n: number) => {
    const order: string[] = [];
    for (let i = 0; i < n; i++) {
      await page.keyboard.press("Tab");
      order.push(await page.evaluate(() => { const a = document.activeElement as HTMLElement; return `${a.tagName.toLowerCase()}: ${(a.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 40)}`; }));
    }
    return order;
  };
  report.smallTouchTargetsGlance = await smallTargets();
  report.keyboardGlance = await tabOrder(8);

  // Keyboard into a domain card and the flag sheet.
  await page.goto(base + "/");
  await page.focus('a[href="/d/money"]');
  await page.keyboard.press("Enter");
  await page.waitForURL(/\/d\/money$/);
  report.smallTouchTargetsDomain = await smallTargets();
  await page.focus("button.flag");
  await page.keyboard.press("Enter");
  const opened = await page.evaluate(() => (document.getElementById("flag-sheet") as HTMLDialogElement).open);
  await page.screenshot({ path: join(outDir, "flag-sheet-phone-390.png") });
  await page.keyboard.press("Escape");
  report.flagSheetKeyboard = {
    cardOpensWithEnter: true,
    opensWithEnter: opened,
    closesWithEscape: await page.evaluate(() => !(document.getElementById("flag-sheet") as HTMLDialogElement).open),
    focusReturnsToButton: await page.evaluate(() => document.activeElement?.classList.contains("flag")),
  };
  const consoleErrors: string[] = [];
  page.on("console", (m) => m.type() === "error" && consoleErrors.push(m.text()));
  page.on("pageerror", (e) => consoleErrors.push(e.message));
  await page.goto(base + "/d/money");
  await page.click("button.flag");
  await page.click("#flag-copy");
  await page.waitForFunction(() => (document.getElementById("flag-status")?.textContent ?? "").length > 0, null, { timeout: 5000 }).catch(() => {});
  report.flagStatusText = await page.textContent("#flag-status");
  await page.goto(base + "/");
  report.consoleErrors = consoleErrors;

  await browser.close();
  server.close();
  writeFileSync(join(outDir, "report.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
