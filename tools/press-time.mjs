#!/usr/bin/env node
/**
 * What the press actually costs, per finish.
 *
 * "Fine is taking too long, I think it is broken" deserves a number rather than an opinion. This drives
 * the real press in a real browser — the same code path a visitor takes — and reports the wall time
 * and the stage lines as they arrive, so a slow stage can be named instead of guessed at.
 *
 *   node tools/press-time.mjs http://localhost:4186 fast
 *   node tools/press-time.mjs http://localhost:4186 fine
 *
 * Caveat, stated up front: this is headless Chromium on the development machine, with software
 * rasterisation, so the absolute numbers are pessimistic and the useful reading is the *ratio* between
 * the two finishes, plus which stage eats the time.
 */

import { chromium } from "playwright";

const url = process.argv[2] ?? "http://localhost:4186";
const asked = process.argv[3] ?? "fast";
const mode = asked === "fine" ? "fine" : asked === "asis" ? "asis" : "fast";

/** The door this run takes: "as it is" has no finish control — it prints fine by definition. */
const enter = async (page) => {
  if (mode === "asis") {
    await page.getByTestId("scene-asis").click();
    return;
  }
  await page.getByTestId(`finish-${mode}`).click();
};

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
const problems = [];
page.on("console", (message) => {
  if (message.type() === "error") problems.push(message.text());
});
page.on("pageerror", (error) => problems.push(String(error)));

await page.goto(url, { waitUntil: "networkidle" });
await enter(page);

const seen = [];
const started = Date.now();
await page.getByTestId("photo-input").setInputFiles("public/art/demo/s1-marisol-keyart.jpg");

// Watch the honest progress lines the press writes, with the time each one appeared.
const poll = setInterval(() => {
  void page
    .locator('[data-testid="converting"] li')
    .allTextContents()
    .then((lines) => {
      for (const line of lines) {
        if (line && !seen.some((entry) => entry.line === line)) {
          seen.push({ line, at: ((Date.now() - started) / 1000).toFixed(1) });
        }
      }
      const last = lines.at(-1);
      if (last) seen.at(-1).at = seen.at(-1).at ?? ((Date.now() - started) / 1000).toFixed(1);
    })
    .catch(() => undefined);
}, 250);

await page.getByTestId("printed-fork").waitFor({ timeout: 600_000 });
clearInterval(poll);
const seconds = (Date.now() - started) / 1000;

console.log(`${mode}: ${seconds.toFixed(1)}s (cold — the segmenter is not in this browser's cache yet)`);
console.log("  stage timeline:");
for (const entry of seen) console.log(`    +${entry.at}s  ${entry.line}`);
if (problems.length) console.log(`  console errors: ${problems.join(" | ")}`);

// The second press in the same session: the model is cached now, so this is the number a visitor sees
// from their second photo onward — and the difference between the two is the honest explanation of
// "the first one takes a while".
await page.getByTestId("take-to-city").waitFor({ timeout: 60_000 });
await page.goto(url, { waitUntil: "networkidle" });
await enter(page);
const warmStarted = Date.now();
const warmSeen = [];
const warmPoll = setInterval(() => {
  void page
    .locator('[data-testid="converting"] li')
    .allTextContents()
    .then((lines) => {
      for (const line of lines) {
        if (line && !warmSeen.some((entry) => entry.line === line)) {
          warmSeen.push({ line, at: ((Date.now() - warmStarted) / 1000).toFixed(1) });
        }
      }
      const last = lines.at(-1);
      if (last && warmSeen.length) warmSeen.at(-1).at = warmSeen.at(-1).at ?? ((Date.now() - warmStarted) / 1000).toFixed(1);
    })
    .catch(() => undefined);
}, 250);
await page.getByTestId("photo-input").setInputFiles("public/art/demo/s1-marisol-keyart.jpg");
await page.getByTestId("printed-fork").waitFor({ timeout: 600_000 });
clearInterval(warmPoll);
console.log(`${mode}: ${((Date.now() - warmStarted) / 1000).toFixed(1)}s (warm — model already cached)`);
console.log("  stage timeline (warm):");
for (const entry of warmSeen) console.log(`    +${entry.at}s  ${entry.line}`);

await browser.close();