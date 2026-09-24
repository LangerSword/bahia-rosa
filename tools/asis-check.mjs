#!/usr/bin/env node
/**
 * "As it is": press a photograph, then keep the plate the visitor would keep.
 *
 * The complaint was "idk wtf is this generation just simply in as it is" — a ghost of the person still in
 * the room behind them. The cause was a coordinate mapping (the ground is a *cropped* copy of the photograph,
 * and the mask was mapped as if it were not), and a mapping bug cannot be caught by arithmetic alone: it has
 * to be looked at. So this presses a real photograph, takes the download the visitor takes, and writes it
 * where it can be examined.
 *
 * Usage: node tools/asis-check.mjs <url> <photo> <outDir> [prefix]
 */
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";

const url = process.argv[2] ?? "http://localhost:4173";
const photo = process.argv[3] ?? "public/art/demo/group-of-four.jpg";
const outDir = process.argv[4] ?? "";
const prefix = process.argv[5] ?? "asis";

if (outDir) mkdirSync(outDir, { recursive: true });
const out = (name) => (outDir ? resolve(outDir, `${prefix}-${name}.png`) : "");

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 950 } });
page.on("console", (message) => {
  if (message.type() === "error") console.log(`  console error: ${message.text()}`);
});
page.on("pageerror", (error) => console.log(`  page error: ${error.message}`));

await page.goto(url, { waitUntil: "domcontentloaded" });
await page.getByTestId("scene-asis").waitFor({ state: "visible", timeout: 30_000 });

// "As it is" is the ground; the photograph is the door. The press starts on the file, and the hour is
// whatever the visitor left it at.
await page.getByTestId("scene-asis").click();
const started = Date.now();
await page.getByTestId("photo-input").setInputFiles(resolve(photo));
await page.getByTestId("printed-fork").waitFor({ state: "visible", timeout: 240_000 });
console.log(`  pressed in ${((Date.now() - started) / 1000).toFixed(1)}s`);

const line = await page.getByTestId("cut-line").textContent().catch(() => null);
if (line) console.log(`  cut line: ${line.trim()}`);

const plate = await page.getByTestId("printed-plate").getAttribute("src");
console.log(`  plate: ${plate?.startsWith("data:image") ? `${Math.round((plate.length / 1024) * 0.75)}KB data URL` : plate}`);

// The download is the same pixels — and it is what a visitor actually keeps.
if (out("plate")) {
  const download = page.waitForEvent("download", { timeout: 30_000 });
  await page.getByTestId("download-raw").click();
  const file = await download;
  await file.saveAs(out("plate"));
  console.log(`  kept the plate → ${out("plate")}`);
}

await browser.close();