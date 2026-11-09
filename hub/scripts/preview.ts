/**
 * Local preview and measurements for the hub, synthetic data only.
 *
 *   npx tsx hub/scripts/preview.ts <outDir> [chromePath]
 *
 * Runs the real Worker handler behind a local HTTP server, with a throwaway signing key standing in
 * for Cloudflare Access, then uses Chrome to take screenshots, walk the page by keyboard, check
 * touch target sizes and time page loads. Nothing here is deployed or used in production.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { join } from "node:path";
import { chromium } from "playwright-core";
import { handle, type HubEnv } from "../src/worker";
import { FIXTURE_SCENARIOS } from "../src/fixtures";
import { AUD, OWNER, TEAM, certsFetch, makeKey, sign } from "../../tests/hubHelpers";

const outDir = process.argv[2] ?? "hub-preview";
const chromePath = process.argv[3] ?? "/usr/bin/google-chrome";
mkdirSync(outDir, { recursive: true });

async function main() {
  const key = await makeKey("preview");
  const { f } = certsFetch([key]);
  const t = Math.floor(Date.now() / 1000);
  const token = await sign(key, { iss: `https://${TEAM}`, aud: [AUD], email: OWNER, type: "app", iat: t, nbf: t, exp: t + 3600 });
  const serverTimes: number[] = [];

  const server = createServer(async (nreq, nres) => {
    const headers = new Headers();
    for (const [k, v] of Object.entries(nreq.headers)) if (typeof v === "string") headers.set(k, v);
    const scenario = headers.get("x-fixture") ?? "normal";
    const env: HubEnv = { ACCESS_TEAM_DOMAIN: TEAM, ACCESS_AUD: AUD, ALLOWED_EMAILS: OWNER, HUB_DATA_MODE: "fixture", HUB_FIXTURE: scenario };
    const t0 = performance.now();
    const res = await handle(new Request(`http://localhost${nreq.url}`, { method: nreq.method, headers }), env, { fetchImpl: f, certCache: {} });
    if (nreq.url === "/") serverTimes.push(performance.now() - t0);
    nres.writeHead(res.status, Object.fromEntries(res.headers));
    nres.end(Buffer.from(await res.arrayBuffer()));
  });
  await new Promise<void>((r) => server.listen(0, r));
  const port = (server.address() as { port: number }).port;
  const base = `http://localhost:${port}/`;

  const browser = await chromium.launch({ executablePath: chromePath, args: ["--no-sandbox"] });
  const report: Record<string, unknown> = {};

  // Screenshots.
  const sizes = [
    { name: "phone-320", width: 320, height: 640, mobile: true },
    { name: "phone-390", width: 390, height: 844, mobile: true },
    { name: "desktop-1280", width: 1280, height: 900, mobile: false },
  ];
  for (const scenario of FIXTURE_SCENARIOS) {
    for (const s of sizes) {
      if (scenario !== "normal" && s.name !== "phone-390") continue;
      const ctx = await browser.newContext({ viewport: { width: s.width, height: s.height }, isMobile: s.mobile, hasTouch: s.mobile, deviceScaleFactor: 2, extraHTTPHeaders: { "cf-access-jwt-assertion": token, "x-fixture": scenario } });
      const page = await ctx.newPage();
      await page.goto(base);
      await page.screenshot({ path: join(outDir, `${scenario}-${s.name}.png`), fullPage: s.name !== "desktop-1280" || scenario === "normal" });
      if (scenario === "normal" && s.name === "phone-320") {
        report.horizontalScrollAt320 = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
      }
      await ctx.close();
    }
  }

  // Signed-out screen, for the record.
  {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, deviceScaleFactor: 2 });
    const page = await ctx.newPage();
    const r = await page.goto(base);
    report.signedOutStatus = r?.status();
    await page.screenshot({ path: join(outDir, "signed-out-phone-390.png") });
    await ctx.close();
  }

  // Phone measurements on the normal day.
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, permissions: ["clipboard-read", "clipboard-write"], extraHTTPHeaders: { "cf-access-jwt-assertion": token, "x-fixture": "normal" } });
  const page = await ctx.newPage();
  const loads: number[] = [];
  for (let i = 0; i < 10; i++) {
    await page.goto(base, { waitUntil: "load" });
    loads.push(await page.evaluate(() => {
      const n = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming;
      return n.loadEventEnd - n.startTime;
    }));
  }
  loads.sort((a, b) => a - b);
  report.localLoadMs = { median: Math.round(loads[5]), max: Math.round(loads[9]), runs: 10 };
  report.serverRenderMs = { median: Number(serverTimes.sort((a, b) => a - b)[Math.floor(serverTimes.length / 2)].toFixed(2)) };
  report.pageBytes = await page.evaluate(async () => (await (await fetch("/")).text()).length + (await (await fetch("/hub.css")).text()).length + (await (await fetch("/hub.js")).text()).length);

  // Throttled: a slow phone network (Chrome devtools "Fast 3G"-like) to approximate a real phone.
  const cdp = await ctx.newCDPSession(page);
  await cdp.send("Network.emulateNetworkConditions", { offline: false, latency: 150, downloadThroughput: (1.6 * 1024 * 1024) / 8, uploadThroughput: (750 * 1024) / 8 });
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
  const slow: number[] = [];
  for (let i = 0; i < 5; i++) {
    await page.goto(base, { waitUntil: "load" });
    slow.push(await page.evaluate(() => {
      const n = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming;
      return n.loadEventEnd - n.startTime;
    }));
  }
  slow.sort((a, b) => a - b);
  report.throttledLoadMs = { median: Math.round(slow[2]), max: Math.round(slow[4]), runs: 5, note: "150 ms latency, 1.6 Mbps down, 4x CPU slowdown, local server" };
  await cdp.send("Network.emulateNetworkConditions", { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: 1 });
  await page.goto(base);

  // Where is the first item? (proxy for "find the next thing fast")
  report.firstItem = await page.evaluate(() => {
    const h1 = document.querySelector("h1")!.getBoundingClientRect();
    const li = document.querySelector(".item")!;
    const r = li.getBoundingClientRect();
    const label = li.querySelector(".item-label")!.textContent;
    return { label, top: Math.round(r.top), bottom: Math.round(r.bottom), viewportHeight: window.innerHeight, h1Top: Math.round(h1.top), visibleItemsInFirstScreen: [...document.querySelectorAll(".items > .item")].filter((e) => e.getBoundingClientRect().bottom <= window.innerHeight).length };
  });

  // Touch targets.
  report.smallTouchTargets = await page.evaluate(() =>
    [...document.querySelectorAll("a, button, summary")]
      .map((e) => ({ text: (e.textContent ?? "").trim().slice(0, 30), h: Math.round(e.getBoundingClientRect().height), w: Math.round(e.getBoundingClientRect().width) }))
      .filter((r) => r.h > 0 && (r.h < 44 || r.w < 44)),
  );

  // Keyboard walk.
  const order: string[] = [];
  for (let i = 0; i < 6; i++) {
    await page.keyboard.press("Tab");
    order.push(await page.evaluate(() => {
      const a = document.activeElement as HTMLElement;
      return `${a.tagName.toLowerCase()}: ${(a.textContent ?? "").trim().slice(0, 40)}`;
    }));
  }
  report.keyboardTabOrderFirst6 = order;
  await page.focus("button.flag");
  await page.keyboard.press("Enter");
  const opened = await page.evaluate(() => (document.getElementById("flag-sheet") as HTMLDialogElement).open);
  await page.screenshot({ path: join(outDir, "flag-sheet-phone-390.png") });
  await page.keyboard.press("Escape");
  const closed = await page.evaluate(() => !(document.getElementById("flag-sheet") as HTMLDialogElement).open);
  const focusBack = await page.evaluate(() => document.activeElement?.classList.contains("flag"));
  report.flagSheetKeyboard = { opensWithEnter: opened, closesWithEscape: closed, focusReturnsToButton: focusBack };

  const consoleErrors: string[] = [];
  page.on("console", (m) => m.type() === "error" && consoleErrors.push(m.text()));
  page.on("pageerror", (e) => consoleErrors.push(e.message));
  await page.goto(base);
  await page.click("button.flag");
  await page.click("#flag-copy");
  await page.waitForFunction(() => (document.getElementById("flag-status")?.textContent ?? "").length > 0, null, { timeout: 5000 }).catch(() => {});
  report.flagStatusText = await page.textContent("#flag-status");
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
