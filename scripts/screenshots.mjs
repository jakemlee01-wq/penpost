// Usage: node scripts/screenshots.mjs <path-to-index.html> <out-dir>
// Captures the main views at 320px and 390px and checks for horizontal overflow.
import { chromium } from "playwright-core";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";

const page_ = resolve(process.argv[2] ?? "dist-single/index.html");
const out = resolve(process.argv[3] ?? "screenshots");
mkdirSync(out, { recursive: true });
const executablePath = process.env.CHROME_PATH ?? undefined;
const browser = await chromium.launch({ executablePath });
const problems = [];

for (const [w, h] of [[320, 568], [390, 844]]) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 2, hasTouch: true });
  const p = await ctx.newPage();
  p.on("pageerror", (e) => problems.push(`${w}: page error ${e.message}`));
  const url = `file://${page_}`;
  const shot = async (name) => {
    await p.waitForTimeout(350);
    const overflow = await p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    if (overflow > 0) problems.push(`${w}px ${name}: horizontal overflow ${overflow}px`);
    await p.screenshot({ path: `${out}/${w}-${name}.png` });
  };

  await p.goto(url + "#/");
  // First visit: pick places
  await shot("0-onboarding");
  await p.getByRole("button", { name: "Twin Cities metro" }).click();
  await p.getByPlaceholder("Search a town, county or region").fill("daw");
  await p.getByRole("button", { name: "Dawson", exact: true }).click();
  await p.getByPlaceholder("Search a town, county or region").fill("");
  await shot("0b-onboarding-picked");
  await p.getByRole("button", { name: "Next: your interests" }).click();
  // Business (Minnesota) is pre-set. Add Minnesota sports and national economy.
  await p.getByRole("radiogroup", { name: "Sports" }).getByRole("radio", { name: "Minnesota" }).click();
  await p.getByRole("radiogroup", { name: "Economy" }).getByRole("radio", { name: "National" }).click();
  await p.getByRole("button", { name: /^Jack/ }).click();
  await shot("0c-interests");
  await p.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await shot("0d-interests-bottom");
  await p.getByRole("button", { name: "Show my edition" }).click();
  await shot("1-deck");
  const label = await p.textContent(".topbar-date");
  if (!label.includes("Twin Cities metro + Dawson")) problems.push(`edition label wrong: ${label}`);
  const total = (await p.textContent(".counter")).split(" of ")[1];
  if (total !== "5") problems.push(`expected 5 stories, got ${total}`);
  const counter = await p.textContent(".counter");
  // Vote, confirm it doesn't navigate, then undo
  await p.click(".vote-up");
  if ((await p.textContent(".counter")) !== counter) problems.push("vote navigated");
  await shot("2-voted");
  await p.click(".vote-up");
  // Swipe left with mouse drag
  const box = await p.locator(".card").boundingBox();
  await p.mouse.move(box.x + box.width * 0.8, box.y + 100);
  await p.mouse.down();
  await p.mouse.move(box.x + box.width * 0.2, box.y + 110, { steps: 8 });
  await p.mouse.up();
  await p.waitForTimeout(150);
  const afterSwipe = await p.textContent(".counter");
  if (!afterSwipe.startsWith("2 of")) problems.push(`swipe did not advance (${afterSwipe})`);
  const votesAfterSwipe = await p.evaluate(() => Object.keys(JSON.parse(localStorage.getItem("penpost.v1")).feedback).length);
  if (votesAfterSwipe !== 0) problems.push("swipe recorded a vote");
  await shot("3-second");
  // Open article from panel
  await p.click(".card-panel");
  await shot("4-article-top");
  await p.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await shot("5-article-end");
  await p.click(".byline");
  await shot("6-writer");
  await p.goBack();
  await p.goBack();
  await p.waitForTimeout(200);
  const back = await p.textContent(".counter");
  if (!back.startsWith("2 of")) problems.push(`back did not return to same card (${back})`);
  // Reload keeps position
  await p.reload();
  if (!(await p.textContent(".counter")).startsWith("2 of")) problems.push("reload lost position");
  // Keyboard to the end
  for (let i = 0; i < 12; i++) await p.keyboard.press("ArrowRight");
  await shot("7-complete");
  await p.goto(url + "#/settings");
  await shot("8-settings");
  await p.goto(url + "#/about");
  await shot("9-about");
  await p.goto(url + "#/today");
  await shot("10-today");
  await ctx.close();
}

// Avatar legibility at 32px
const ctx = await browser.newContext({ viewport: { width: 400, height: 120 }, deviceScaleFactor: 2 });
const p = await ctx.newPage();
await p.goto(`file://${page_}#/about`);
await p.addStyleTag({ content: ".writer-grid .avatar{width:32px!important;height:32px!important}" });
await p.waitForTimeout(300);
await p.locator(".writer-grid").screenshot({ path: `${out}/avatars-32px.png` });
await browser.close();

console.log(problems.length ? "PROBLEMS:\n" + problems.join("\n") : "All flow checks passed.");
process.exit(problems.length ? 1 : 0);
