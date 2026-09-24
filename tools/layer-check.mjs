#!/usr/bin/env node
/**
 * Does the layer move the *person*, or the whole picture?
 *
 * The complaint is "layering still doesn't work", and there are two very different faults behind that
 * sentence: the drag doing nothing at all, and the drag moving the entire frame (background included) so it
 * reads as panning a photo rather than placing somebody in it. This tells them apart by measuring the
 * canvas: after a drag, the person's region must have changed and the ground's corner must not have.
 *
 *   node tools/layer-check.mjs https://langersword.github.io/bahia-rosa/
 */

import { chromium } from "playwright";

const url = process.argv[2] ?? "http://localhost:4187";
const photo = process.argv[3] ?? "public/art/demo/s1-marisol-keyart.jpg";

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
const problems = [];
page.on("console", (message) => {
  if (message.type() === "error") problems.push(message.text());
});
page.on("pageerror", (error) => problems.push(String(error)));

await page.goto(url, { waitUntil: "networkidle" });
await page.getByTestId("photo-input").setInputFiles(photo);
await page.getByTestId("printed-fork").waitFor({ timeout: 240_000 });

// What the press handed over: are there actually two layers, or is this a flattened plate?
const handed = await page.evaluate(() => {
  const image = document.querySelector('[data-testid="printed-plate"]');
  return image ? (image.getAttribute("src") ?? "").slice(0, 24) : "no plate";
});
console.log(`the plate is a ${handed}…`);

await page.getByTestId("take-to-city").click();
await page.getByTestId("launch").waitFor({ timeout: 60_000 });
await page.waitForTimeout(2500);

/** The selected surface's canvas, sampled: one corner (ground only) and the middle-bottom (person). */
const sample = async () =>
  page.evaluate(() => {
    const canvas = document.querySelector('[data-testid^="place-"][aria-pressed="true"] canvas');
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
      // Two corners: if these move, the *ground* moved, which is the bug.
      topLeft: grab(0.02, 0.02, 0.16, 0.16),
      topRight: grab(0.82, 0.02, 0.16, 0.16),
      // The subject stands centre-bottom on every surface.
      subject: grab(0.4, 0.55, 0.2, 0.35),
      size: `${canvas.width}x${canvas.height}`,
    };
  });

const before = await sample();
// A frame-time sampler, so "smooth" is a number and not an opinion: the worst gap between frames while a
// drag is happening is what stutter looks like.
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
await page.waitForTimeout(1200);
const after = await sample();

const stored = await page.evaluate(() => {
  const raw = window.localStorage.getItem("bahia-rosa.payoff.v1");
  return raw ? JSON.parse(raw).layer ?? null : null;
});

const gaps = await page.evaluate(() => {
  const list = (window.__gaps ?? []).slice(3);
  list.sort((a, b) => a - b);
  return {
    worst: Math.round(list[list.length - 1] ?? 0),
    median: Math.round(list[Math.floor(list.length / 2)] ?? 0),
    frames: list.length,
  };
});
console.log(`  frames during the drag: ${gaps.frames} · median gap ${gaps.median}ms · worst ${gaps.worst}ms`);

const round = (value) => (typeof value === "number" ? Math.round(value * 10) / 10 : value);
console.log(`canvas ${before?.size}`);
console.log(`  before  ground ${round(before?.topLeft)}/${round(before?.topRight)}  person ${round(before?.subject)}`);
console.log(`  after   ground ${round(after?.topLeft)}/${round(after?.topRight)}  person ${round(after?.subject)}`);
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
      : "  VERDICT: the person moved and the ground stayed — the layer is doing its job",
  );
} else {
  console.log("  VERDICT: the arrangement changed but the canvas barely did — the layer may be drawn under the ground");
}
if (problems.length) console.log("  console errors:", problems.join(" | "));

await browser.close();