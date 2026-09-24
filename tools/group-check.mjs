#!/usr/bin/env node
/**
 * A group photo, end to end in a real browser.
 *
 * The failure this exists for: four people in one frame, the old mask kept only the largest of them, and
 * the degenerate result sent the visitor to a "no print desk is running" screen — a machine that does not
 * exist for anyone visiting the deployed site. Three things have to hold, and this checks all three:
 *
 *   1. a group is *cut* rather than reduced to one person — the frame comes off the press with the whole
 *      group in it, and the cut line reports it;
 *   2. a press that cannot cope degrades to painting the whole frame, or reports itself at the intake;
 *   3. and it *never* lands on the desk screen.
 *
 *   node tools/group-check.mjs http://localhost:4187
 */

import { chromium } from "playwright";

const url = process.argv[2] ?? "http://localhost:4187";
const photo = "public/art/demo/group-of-four.jpg";

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
const problems = [];
page.on("console", (message) => {
  if (message.type() === "error") problems.push(message.text());
});
page.on("pageerror", (error) => problems.push(String(error)));

await page.goto(url, { waitUntil: "networkidle" });
const started = Date.now();
await page.getByTestId("photo-input").setInputFiles(photo);

const outcome = await Promise.race([
  page.getByTestId("printed-fork").waitFor({ timeout: 240_000 }).then(() => "fork"),
  page.getByTestId("press-error").waitFor({ timeout: 240_000 }).then(() => "press-error"),
  page.getByTestId("print-desk").waitFor({ timeout: 240_000 }).then(() => "desk"),
]).catch(() => "timeout");

const seconds = ((Date.now() - started) / 1000).toFixed(1);
console.log(`group of four: ${outcome} in ${seconds}s`);

if (outcome === "fork") {
  console.log("  cut line:", (await page.getByTestId("cut-line").textContent())?.trim());
  console.log(
    "  plate:",
    await page.getByTestId("printed-plate").evaluate((node) => {
      const image = node;
      return `${image.naturalWidth}x${image.naturalHeight}`;
    }),
  );
}
if (outcome === "press-error") {
  console.log("  reported:", (await page.getByTestId("press-error").textContent())?.trim());
}
if (outcome === "desk") console.log("  REGRESSION: it fell through to the desk screen");
if (problems.length) console.log("  console errors:", problems.join(" | "));

await browser.close();