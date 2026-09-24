#!/usr/bin/env node
/**
 * Press one photograph through the real app, and keep everything it produces.
 *
 *   node tools/paint-photo.mjs <photo> [url] [out-dir]
 *
 * Saves the fork's plate (what the press alone makes) and then takes it into the city and saves all
 * four surfaces — billboard, foyer, feed, postcard — exactly as a visitor's downloads would arrive.
 * The cut line and the plate's real size are printed, so the run reports what happened rather than
 * "done".
 *
 * This is the honest end-to-end check for a *specific* photo: point it at the file you care about,
 * against the deployed URL, and open the outputs it leaves behind.
 */

import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import { basename, resolve } from "node:path";

const photo = resolve(process.argv[2] ?? "public/art/demo/group-of-four.jpg");
const url = process.argv[3] ?? "http://localhost:4187";
const outDir = resolve(process.argv[4] ?? "painted");
mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
const problems = [];
page.on("console", (message) => {
  if (message.type() !== "error") return;
  // A host without a desk probes for one on purpose; that failure is expected, not a problem.
  const location = message.location()?.url ?? "";
  if (location.includes("/print-desk/")) return;
  problems.push(message.text());
});
page.on("pageerror", (error) => problems.push(String(error)));

await page.goto(url, { waitUntil: "domcontentloaded" });
await page.getByTestId("choose-photo").waitFor({ timeout: 60_000 });
if (process.argv.includes("--fine")) {
  // The slower finish, on request: bigger, truer colour. Default stays fast, like the page's own.
  await page.getByTestId("finish-fine").click();
}
const started = Date.now();
await page.getByTestId("photo-input").setInputFiles(photo);

const outcome = await Promise.race([
  page.getByTestId("printed-fork").waitFor({ timeout: 300_000 }).then(() => "fork"),
  page.getByTestId("press-error").waitFor({ timeout: 300_000 }).then(() => "press-error"),
  page.getByTestId("print-desk").waitFor({ timeout: 300_000 }).then(() => "desk"),
]).catch(() => "timeout");

const seconds = ((Date.now() - started) / 1000).toFixed(1);
console.log(`${basename(photo)}: ${outcome} in ${seconds}s`);

if (outcome !== "fork") {
  if (outcome === "press-error") {
    console.log("  reported:", (await page.getByTestId("press-error").textContent())?.trim());
  }
  if (outcome === "desk") console.log("  REGRESSION: the press fell through to the desk screen");
  if (problems.length) console.log("  console errors:", problems.join(" | "));
  await browser.close();
  process.exit(1);
}

console.log("  cut line:", (await page.getByTestId("cut-line").textContent())?.trim());
console.log(
  "  plate:",
  await page.getByTestId("printed-plate").evaluate((node) => `${node.naturalWidth}x${node.naturalHeight}`),
);

// The plate itself, as the raw download arrives: a clean PNG under the photo's own name.
const [raw] = await Promise.all([page.waitForEvent("download"), page.getByTestId("download-raw").click()]);
const rawPath = `${outDir}/${raw.suggestedFilename()}`;
await raw.saveAs(rawPath);
console.log("  saved:", rawPath);

// The city: take the plate in, then download all four surfaces.
await page.getByTestId("take-to-city").click();
await page.getByTestId("launch").waitFor({ timeout: 60_000 });
const downloads = [];
page.on("download", (download) => downloads.push(download));
await page.getByTestId("download-all").click();
const deadline = Date.now() + 90_000;
while (downloads.length < 4 && Date.now() < deadline) await page.waitForTimeout(250);
for (const download of downloads) {
  const path = `${outDir}/${download.suggestedFilename()}`;
  await download.saveAs(path);
  console.log("  saved:", path);
}
if (downloads.length < 4) console.log(`  WARNING: only ${downloads.length} of 4 surfaces downloaded`);

if (problems.length) console.log("  console errors:", problems.join(" | "));
await browser.close();