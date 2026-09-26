#!/usr/bin/env node
/**
 * Does the arrangement move the *person*, or the whole picture — and does anything dark travel with them?
 *
 * Two faults wear the same sentence ("layering doesn't work"): a drag that does nothing, and a drag that
 * moves the entire frame so it reads as panning a photograph rather than placing somebody in it. This tells
 * them apart by measuring the canvas — after a drag the person's region must change and the ground's corners
 * must not — and it watches the frame gaps while it happens, because a drag that repaints at 8fps reads as
 * broken even when every number is right.
 *
 * It also *keeps* the frame it measured, so the thing being measured can be looked at rather than trusted:
 * the shadow the visitor called a "weird black shadow boundary" was a rectangle of dark tint with a hard
 * edge, and no corner average would have caught it.
 *
 * The arrangement lives in the editing phase now, so the tool drags there and then walks out to the city to
 * sample what the surfaces actually print.
 *
 *   node tools/layer-check.mjs https://bahia.langersword.in/ [outDir]
 */

import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";

const url = process.argv[2] ?? "http://localhost:4187";
const outDir = process.argv[3] ?? "";
const photo = process.argv[4] ?? "public/art/demo/s1-marisol-keyart.jpg";
if (outDir) mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
const problems = [];
page.on("console", (message) => {
  if (message.type() === "error") problems.push(message.text());
});
page.on("pageerror", (error) => problems.push(String(error)));

await page.goto(url, { waitUntil: "domcontentloaded" });
await page.getByTestId("photo-input").setInputFiles(photo);
await page.getByTestId("printed-fork").waitFor({ timeout: 240_000 });

// Into the editing phase, where the arrangement lives.
await page.getByTestId("edit-in-editor").click();
await page.getByTestId("arrange").waitFor({ state: "visible", timeout: 60_000 });
await page.waitForTimeout(1500);

/** One canvas, sampled: the ground's corners (must not move) and the person's patch (must move). */
const sample = async (selector) =>
  page.evaluate((sel) => {
    const canvas = document.querySelector(sel);
    if (!(canvas instanceof HTMLCanvasElement)) return null;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    const grab = (x, y, w, h) => {
      const data = ctx.getImageData(
        Math.round(x * canvas.width),
        Math.round(y * canvas.height),
        Math.max(1, Math.round(w * canvas.width)),
        Math.max(1, Math.round(h * canvas.height)),
      ).data;
      let sum = 0;
      for (let i = 0; i < data.length; i += 4) sum += data[i] + data[i + 1] + data[i + 2];
      return sum / (data.length / 4) / 3;
    };
    return {
      topLeft: grab(0.02, 0.02, 0.16, 0.16),
      topRight: grab(0.82, 0.02, 0.16, 0.16),
      subject: grab(0.4, 0.55, 0.2, 0.35),
      size: `${canvas.width}x${canvas.height}`,
    };
  }, selector);

const arrangeCanvas = '[data-testid="layer-surface"] canvas';
const before = await sample(arrangeCanvas);

// A frame-time sampler, so "smooth" is a number and not an opinion.
await page.evaluate(() => {
  window.__gaps = [];
  let last = performance.now();
  const tick = (now) => {
    window.__gaps.push(now - last);
    last = now;
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
});

const surface = page.getByTestId("layer-surface");
const box = await surface.boundingBox();
if (!box) throw new Error("no drag surface");
await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
await page.mouse.down();
await page.mouse.move(box.x + box.width / 2 + box.width * 0.18, box.y + box.height / 2, { steps: 8 });
await page.mouse.up();
await page.waitForTimeout(900);

const after = await sample(arrangeCanvas);
const gaps = await page.evaluate(() => {
  const list = (window.__gaps ?? []).slice(3);
  list.sort((a, b) => a - b);
  return {
    worst: Math.round(list[list.length - 1] ?? 0),
    median: Math.round(list[Math.floor(list.length / 2)] ?? 0),
    frames: list.length,
  };
});

const stored = await page.evaluate(() => {
  const raw = window.localStorage.getItem("bahia-rosa.payoff.v1");
  return raw ? JSON.parse(raw).layer ?? null : null;
});

const round = (value) => (typeof value === "number" ? Math.round(value * 10) / 10 : value);
console.log(`the arrangement, in the editing phase — canvas ${before?.size}`);
console.log(`  before  ground ${round(before?.topLeft)}/${round(before?.topRight)}  person ${round(before?.subject)}`);
console.log(`  after   ground ${round(after?.topLeft)}/${round(after?.topRight)}  person ${round(after?.subject)}`);
console.log(`  frames during the drag: ${gaps.frames} · median gap ${gaps.median}ms · worst ${gaps.worst}ms`);
console.log(`  stored layer: ${JSON.stringify(stored)}`);

if (!stored || (stored.dx === 0 && stored.dy === 0)) {
  console.log("  VERDICT: the drag did not reach the arrangement at all");
} else if (Math.abs((after?.subject ?? 0) - (before?.subject ?? 0)) > 1.5) {
  const groundMoved =
    Math.abs((after?.topLeft ?? 0) - (before?.topLeft ?? 0)) > 1.5 ||
    Math.abs((after?.topRight ?? 0) - (before?.topRight ?? 0)) > 1.5;
  console.log(
    groundMoved
      ? "  VERDICT: the whole picture moved — the ground is not independent of the layer"
      : "  VERDICT: the person moved and the ground stayed — the arrangement is doing its job",
  );
} else {
  console.log("  VERDICT: the arrangement changed but the canvas barely did — the layer may be drawn under the ground");
}

if (outDir) {
  await surface.screenshot({ path: resolve(outDir, "arrange-after-drag.png") });
  console.log(`  kept the arranged frame → ${resolve(outDir, "arrange-after-drag.png")}`);
}

// And out to the city, where the surfaces print the arrangement — no controls of their own.
await page.getByTestId("arrange-to-city").click();
await page.getByTestId("launch").waitFor({ state: "visible", timeout: 60_000 });
await page.waitForTimeout(2500);
const cityCanvas = '[data-testid^="place-"][aria-pressed="true"] canvas';
const printed = await sample(cityCanvas);
console.log(`the printed surface — canvas ${printed?.size} · person patch ${round(printed?.subject)}`);
if (outDir) {
  const selected = await page.evaluate(
    () => document.querySelector('[data-testid^="place-"][aria-pressed="true"]')?.getAttribute("data-testid") ?? "place",
  );
  const node = page.getByTestId(selected).locator("canvas");
  await node.screenshot({ path: resolve(outDir, `city-${selected}.png`) });
  console.log(`  kept the printed surface → ${resolve(outDir, `city-${selected}.png`)}`);
}

if (problems.length) console.log("  console errors:", problems.join(" | "));
await browser.close();