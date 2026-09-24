#!/usr/bin/env node
/**
 * A group photo, end to end in a real browser — and the frames it makes, saved so a person can look.
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
 *   node tools/group-check.mjs http://localhost:4187 [outDir] [photo] [prefix]
 *
 * What it saves (docs/shots by default): the pressed plate, and every placement canvas on the city stage.
 * A claim about a picture that nobody looks at is not evidence.
 */

import { writeFile, mkdir } from "node:fs/promises";
import { chromium } from "playwright";

const url = process.argv[2] ?? "http://localhost:4187";
const outDir = process.argv[3] ?? "docs/shots";
const photo = process.argv[4] ?? "public/art/demo/group-of-four.jpg";
/** Names the saved frames, so a run with a real photograph does not overwrite the fixture's. */
const prefix = process.argv[5] ?? "group";

/** Playwright hands this function to the page; it reads a blob:/data: URL into bytes as base64. */
const grab = (source) => {
  return fetch(source)
    .then((response) => response.blob())
    .then(
      (blob) =>
        new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result).split(",")[1] ?? "");
          reader.onerror = () => reject(new Error("could not read the frame"));
          reader.readAsDataURL(blob);
        }),
    );
};

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
const problems = [];
page.on("console", (message) => {
  if (message.type() === "error") problems.push(message.text());
});
page.on("pageerror", (error) => problems.push(String(error)));

await page.goto(url, { waitUntil: "networkidle" });
await mkdir(outDir, { recursive: true });

const started = Date.now();
await page.getByTestId("photo-input").setInputFiles(photo);

const outcome = await Promise.race([
  page.getByTestId("printed-fork").waitFor({ timeout: 240_000 }).then(() => "fork"),
  page.getByTestId("press-error").waitFor({ timeout: 240_000 }).then(() => "press-error"),
  page.getByTestId("print-desk").waitFor({ timeout: 240_000 }).then(() => "desk"),
]).catch(() => "timeout");

const seconds = ((Date.now() - started) / 1000).toFixed(1);
console.log(`${photo}: ${outcome} in ${seconds}s`);

if (outcome === "fork") {
  console.log("  cut line:", (await page.getByTestId("cut-line").textContent())?.trim());
  const plate = await page
    .getByTestId("printed-plate")
    .evaluate((node) => ({ src: node.src, width: node.naturalWidth, height: node.naturalHeight }));
  console.log(`  plate: ${plate.width}x${plate.height}`);
  const bytes = await page.evaluate(grab, plate.src);
  await writeFile(`${outDir}/${prefix}-plate.png`, Buffer.from(bytes, "base64"));
  console.log(`  saved ${outDir}/${prefix}-plate.png`);

  // Into the city, so the placements can be saved too — the part that answers "can it draw the group":
  // the group composited into a real surface, not a cut-out on its own.
  await page.getByTestId("take-to-city").click();
  await page.getByTestId("launch").waitFor({ timeout: 60_000 });
  await page.waitForTimeout(2500); // let the placements finish their first draw
  const canvases = await page.evaluate(() => {
    const found = [];
    for (const canvas of document.querySelectorAll("canvas")) {
      const holder = canvas.closest("[data-testid]");
      const label = holder?.getAttribute("data-testid") ?? `canvas-${found.length}`;
      try {
        const data = canvas.toDataURL("image/png");
        if (data.length > 4000) found.push({ label, width: canvas.width, height: canvas.height, data });
      } catch {
        // A canvas this page will not let us read is not a failure of the press.
      }
    }
    return found;
  });
  for (const canvas of canvases) {
    const name = `${outDir}/${prefix}-${canvas.label.replace(/[^a-z0-9-]/gi, "-")}.png`;
    await writeFile(name, Buffer.from(canvas.data.split(",")[1], "base64"));
    console.log(`  saved ${name}  (${canvas.width}x${canvas.height})`);
  }
  if (!canvases.length) console.log("  no placement canvases found on the city stage");
}

if (outcome === "press-error") {
  console.log("  reported:", (await page.getByTestId("press-error").textContent())?.trim());
}
if (outcome === "desk") console.log("  REGRESSION: it fell through to the desk screen");
if (problems.length) console.log("  console errors:", problems.join(" | "));

await browser.close();