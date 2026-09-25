/**
 * Real-photograph samples for the README.
 *
 * The fixture gallery was generated from the demo images that ship with the repo, and they looked like it:
 * a synthetic key-art and a four-up portrait sheet, pressed into plates. The README's examples should show
 * what the press does to a *photograph*, so this drives the real product with any photo and keeps the plate
 * (and optionally one city surface), the same way `sample-set.mjs` does for the fixtures.
 *
 * Usage:
 *   node tools/real-samples.mjs <url> <outDir> <photo> <name> [fine|fast|asit] [city]
 *
 *   node tools/real-samples.mjs http://localhost:4213 docs/samples /tmp/real/lovell.jpg lovell fine city
 */

import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";

const url = process.argv[2] ?? "http://localhost:4180";
const outDir = resolve(process.argv[3] ?? "docs/samples");
const photo = process.argv[4];
const name = process.argv[5];
const finish = process.argv[6] ?? "fine";
const withCity = process.argv[7] === "city";
if (!photo || !name) throw new Error("usage: real-samples.mjs <url> <outDir> <photo> <name> [fine|fast|asit] [city]");

mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 950 } });
page.on("pageerror", (error) => console.log(`  page error: ${error.message}`));

const keep = async (file, clickTestId) => {
  const download = page.waitForEvent("download", { timeout: 120_000 });
  await page.getByTestId(clickTestId).click();
  const saved = await download;
  await saved.saveAs(resolve(outDir, file));
  console.log(`  ${file}`);
};

await page.goto(url, { waitUntil: "domcontentloaded" });
await page.getByTestId("scene-asis").waitFor({ state: "attached" });
if (finish === "asit") await page.getByTestId("scene-asis").click();
else await page.getByTestId(`finish-${finish}`).click();
await page.getByTestId("photo-input").setInputFiles(resolve(photo));
await page.getByTestId("printed-fork").waitFor({ state: "visible", timeout: 300_000 });

await keep(`${name}-plate.png`, "download-raw");

if (withCity) {
  await page.getByTestId("edit-in-editor").click();
  await page.getByTestId("arrange").waitFor({ state: "visible", timeout: 60_000 });
  await page.waitForTimeout(2500);
  await page.getByTestId("arrange-to-city").click();
  await page.getByTestId("launch").waitFor({ state: "visible", timeout: 60_000 });
  await page.waitForTimeout(2500);
  await page.getByTestId("place-billboard").click();
  await page.waitForTimeout(1500);
  await keep(`${name}-billboard.png`, "download-billboard");
}

await browser.close();
console.log(`${name}: done`);