#!/usr/bin/env node
/**
 * One plate, kept — so the thing being judged can be looked at instead of described.
 *
 * The finishes are tuned against complaints ("less details in lines and sketching, but at least the text and
 * everything should look right"), and a complaint about how a picture *looks* can only be answered by a
 * picture. This presses the demo fixture through a chosen finish and writes the plate the visitor would keep.
 *
 * Usage: node tools/plate-shot.mjs <url> <outDir> [finish] [photo]
 */

import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";

const url = process.argv[2] ?? "http://localhost:4180";
const outDir = resolve(process.argv[3] ?? "/tmp");
const finish = process.argv[4] ?? "fast";
const photo = process.argv[5] ?? "public/art/demo/s1-marisol-keyart.jpg";
mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 950 } });
page.on("pageerror", (error) => console.log(`  page error: ${error.message}`));

await page.goto(url, { waitUntil: "domcontentloaded" });
await page.getByTestId("scene-asis").waitFor({ state: "attached" });
if (finish === "as-is") await page.getByTestId("scene-asis").click();
else await page.getByTestId(`finish-${finish}`).click();
const started = Date.now();
await page.getByTestId("photo-input").setInputFiles(resolve(photo));
await page.getByTestId("printed-fork").waitFor({ state: "visible", timeout: 300_000 });
console.log(`  pressed in ${((Date.now() - started) / 1000).toFixed(1)}s`);
console.log(`  ${(await page.getByTestId("cut-line").textContent().catch(() => ""))?.trim()}`);

const download = page.waitForEvent("download", { timeout: 60_000 });
await page.getByTestId("download-raw").click();
const file = await download;
const path = resolve(outDir, `plate-${finish}.png`);
await file.saveAs(path);
console.log(`  → ${path}`);

await browser.close();