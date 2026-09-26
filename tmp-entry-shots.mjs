/**
 * Throwaway: fresh renders of the entry — the assembled title, and the dust leaving — for the design gate
 * and for the three faults this round fixed (fallback-face assembly, the hole at the hand-off, chunky dust).
 *
 *   node tmp-entry-shots.mjs
 */
import { chromium } from "playwright";

const BASE = process.env.SHOT_BASE ?? "http://localhost:5178";
const out = "docs/shots";

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
const page = await context.newPage();

await page.goto(`${BASE}/?entry=1`, { waitUntil: "domcontentloaded" });
await page.waitForSelector('[data-testid="entry"]');

// The title must be assembled *in Limelight* before this fires: the face gate is the whole point.
await page.waitForSelector('[data-testid="entry"][data-face="ready"]', { timeout: 30000 });
await page.waitForFunction(
  `[...document.querySelectorAll(".entry-letter")].every((el) => {
     const t = getComputedStyle(el).transform;
     return t === "none" || /matrix\\(1, 0, 0, 1, 0, 0\\)/.test(t);
   })`,
  null,
  { timeout: 15000 },
);
const face = await page.evaluate(() => ({
  limelight: document.fonts.check('20px "Limelight"'),
  width: Math.round(document.querySelector(".entry-wordmark").getBoundingClientRect().width),
}));
console.log("title assembled:", JSON.stringify(face));
await page.waitForTimeout(300);
await page.screenshot({ path: `${out}/entry-title.png` });
console.log("entry-title: shot");

// Mid-dust: the canvas is up and the wave is crossing.
await page.waitForSelector(".vapour-host canvas", { timeout: 15000 });
await page.waitForTimeout(420);
await page.screenshot({ path: `${out}/entry-vapour.png` });
console.log("entry-vapour: shot");

await browser.close();
console.log("done");