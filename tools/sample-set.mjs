#!/usr/bin/env node
/**
 * The sample set: what the product actually hands a visitor, kept as pictures.
 *
 * Every claim in the README about what the app produces should be checkable by looking at what it produced. So
 * this drives the real press in a real browser — the same doors a visitor takes — and keeps the downloads,
 * not screenshots of them:
 *
 *   docs/samples/plate-fast.png        the press's frame, fast finish
 *   docs/samples/plate-fine.png        the press's frame, fine finish
 *   docs/samples/plate-as-it-is.png    the whole photograph, repainted (no cut, no layers)
 *   docs/samples/frame-outline.png     the arrangement in the editing phase, outline and corners visible
 *   docs/samples/frame-alone.png       "the frame on its own" — no surface, no mount, no words
 *   docs/samples/city-*.png            the four city surfaces, arranged and downloaded
 *
 * Usage: node tools/sample-set.mjs http://localhost:4180 [outDir]
 */

import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";

const url = process.argv[2] ?? "http://localhost:4180";
const outDir = resolve(process.argv[3] ?? "docs/samples");
mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 950 } });
page.on("console", (message) => {
  if (message.type() === "error") console.log(`  console error: ${message.text()}`);
});
page.on("pageerror", (error) => console.log(`  page error: ${error.message}`));

const keep = async (name, clickTestId) => {
  const download = page.waitForEvent("download", { timeout: 60_000 });
  await page.getByTestId(clickTestId).click();
  const file = await download;
  await file.saveAs(resolve(outDir, name));
  console.log(`  ${name}`);
};

/** One press, from the intake to the fork. */
const press = async (photo, { asItIs = false, finish = "fast" } = {}) => {
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await page.getByTestId("scene-asis").waitFor({ state: "attached" });
  if (asItIs) await page.getByTestId("scene-asis").click();
  else await page.getByTestId(`finish-${finish}`).click();
  await page.getByTestId("photo-input").setInputFiles(resolve(photo));
  await page.getByTestId("printed-fork").waitFor({ state: "visible", timeout: 300_000 });
};

// 1. The press's own frame, both finishes.
await press("public/art/demo/s1-marisol-keyart.jpg", { finish: "fast" });
await keep("plate-fast.png", "download-raw");
await press("public/art/demo/s1-marisol-keyart.jpg", { finish: "fine" });
await keep("plate-fine.png", "download-raw");

// 2. "As it is": the whole photograph, repainted and graded — no cut, no layers, no model.
await press("public/art/demo/group-of-four.jpg", { asItIs: true });
await keep("plate-as-it-is.png", "download-raw");

// 3. The arrangement, in the editing phase, with its outline and corners. The arrangement is made with a real
//    pointer drag — the gesture a visitor makes, and the one the e2e drives — because the frame is composed
//    ~450ms after the last change and the editor remounts on it, so the layout settles a moment later.
await press("public/art/demo/s1-marisol-keyart.jpg", { finish: "fast" });
await page.getByTestId("edit-in-editor").click();
await page.getByTestId("arrange").waitFor({ state: "visible", timeout: 60_000 });
await page.getByTestId("layer-outline").waitFor({ state: "visible", timeout: 60_000 });
await page.waitForTimeout(3000);
const surface = await page.getByTestId("layer-surface").boundingBox();
if (!surface) throw new Error("no frame to drag in");
await page.mouse.move(surface.x + surface.width / 2, surface.y + surface.height / 2);
await page.mouse.down();
await page.mouse.move(
  surface.x + surface.width / 2 + surface.width * 0.12,
  surface.y + surface.height / 2 - surface.height * 0.06,
  { steps: 10 },
);
await page.mouse.up();
await page.waitForTimeout(2500);
await page.getByTestId("layer-surface").screenshot({ path: resolve(outDir, "frame-outline.png") });
console.log("  frame-outline.png");

// 4. And what the city prints: the four surfaces, downloaded, plus the frame on its own.
await page.getByTestId("arrange-to-city").click();
await page.getByTestId("launch").waitFor({ state: "visible", timeout: 60_000 });
await page.waitForTimeout(3000);
for (const id of ["billboard", "venue", "feed", "postcard"]) {
  await page.getByTestId(`place-${id}`).click();
  await page.waitForTimeout(1200);
  await keep(`city-${id}.png`, `download-${id}`);
}
await keep("frame-alone.png", "download-plain");

await browser.close();
console.log(`samples → ${outDir}`);