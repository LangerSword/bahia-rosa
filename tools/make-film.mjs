/**
 * Build the welcome screen's film: a city plate being generated, step by step, then the city in its hours.
 *
 * No faces. The frames are the plates the city draws of *itself* — the four scenes the press prints into —
 * put through the app's own pipeline: the drawing as it arrives, the hour's grade (`gradePixels`/`gradeFor`),
 * then the flattening at rising colour counts (`styliseImageData` with the press's own FAST preset), and
 * finally the city at other hours. Every frame here is a function this app ships; the script only calls them.
 *
 * Fifteen cells of 896×504 in a 5×3 grid — no spare cells, because a spare cell is a black square that reads as
 * a broken frame. The labels each cell carries on screen live in `src/components/PlateFilm.tsx`, in the same
 * order, and this script prints the list it built so the two can be compared.
 *
 *   node tools/make-film.mjs        # needs the dev server (npm run dev) on :5178
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { chromium } from "playwright";

const BASE = process.env.SHOT_BASE ?? "http://localhost:5178";
const CELL_W = 896;
const CELL_H = 504;
const COLS = 5;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
page.on("pageerror", (error) => console.error("page error:", error.message));
await page.goto(BASE, { waitUntil: "domcontentloaded" });
await page.waitForFunction("window.__press && window.__press.styliseImageData", null, { timeout: 30000 });

const result = await page.evaluate(
  async ({ cellW, cellH, cols }) => {
    const press = window.__press;
    const preset = press.FAST?.options ?? press.FAST;
    const load = (src) =>
      new Promise((resolve, reject) => {
        const image = new Image();
        image.onload = () => resolve(image);
        image.onerror = () => reject(new Error(`could not load ${src}`));
        image.src = src;
      });

    const working = document.createElement("canvas");
    working.width = cellW;
    working.height = cellH;
    const wctx = working.getContext("2d", { willReadFrequently: true });
    const probe = document.createElement("canvas");
    probe.width = 32;
    probe.height = 18;
    const pctx = probe.getContext("2d", { willReadFrequently: true });

    /** The scene, cover-fit, optionally graded and flattened — all through the press's own functions. */
    async function frame(scene, look, colours) {
      const image = await load(press.sceneSrc(scene));
      const scale = Math.max(cellW / image.naturalWidth, cellH / image.naturalHeight);
      const dw = image.naturalWidth * scale;
      const dh = image.naturalHeight * scale;
      wctx.drawImage(image, (cellW - dw) / 2, (cellH - dh) / 2, dw, dh);
      let data = wctx.getImageData(0, 0, cellW, cellH);
      if (look) {
        const graded = press.gradePixels(data.data, press.gradeFor(look));
        data = new ImageData(graded, cellW, cellH);
      }
      if (colours) {
        // The press takes a pixel array and hands one back: passing the ImageData wrapper reads `undefined`
        // as its length and returns nothing at all.
        const out = press.styliseImageData(data.data, cellW, cellH, { ...preset, colours });
        const bytes = out?.data ?? out;
        data = new ImageData(bytes, cellW, cellH);
      }
      wctx.putImageData(data, 0, 0);
      // A frame that came back one flat colour is a frame that failed: report it rather than shipping it.
      pctx.drawImage(working, 0, 0, 32, 18);
      const px = pctx.getImageData(0, 0, 32, 18).data;
      let lo = 255;
      let hi = 0;
      for (let i = 0; i < px.length; i += 4) {
        const luma = px[i] * 0.299 + px[i + 1] * 0.587 + px[i + 2] * 0.114;
        lo = Math.min(lo, luma);
        hi = Math.max(hi, luma);
      }
      return { canvas: working, flat: hi - lo < 6 };
    }

    const steps = [
      { scene: "beach", look: null, colours: null, label: "the city's own drawing" },
      { scene: "beach", look: "dusk", colours: null, label: "the hour — dusk" },
      { scene: "beach", look: "dusk", colours: 3, label: "3 colours" },
      { scene: "beach", look: "dusk", colours: 4, label: "4 colours" },
      { scene: "beach", look: "dusk", colours: 6, label: "6 colours" },
      { scene: "beach", look: "dusk", colours: 9, label: "9 colours" },
      { scene: "beach", look: "dusk", colours: 13, label: "13 colours" },
      { scene: "beach", look: "dusk", colours: 20, label: "20 colours — the plate" },
      { scene: "marina", look: "golden", colours: 20, label: "the marina, at golden hour" },
      { scene: "rooftop", look: "night", colours: 20, label: "the rooftop, at night" },
      { scene: "boulevard", look: "neon", colours: 20, label: "palm boulevard, in the neon" },
      { scene: "beach", look: "night", colours: 20, label: "the beach, after dark" },
      { scene: "marina", look: "night", colours: 20, label: "the marina, after dark" },
      { scene: "boulevard", look: "golden", colours: 20, label: "palm boulevard, at golden hour" },
      { scene: "rooftop", look: "dusk", colours: 20, label: "the rooftop, at dusk" },
    ];

    const sprite = document.createElement("canvas");
    sprite.width = cellW * cols;
    sprite.height = cellH * Math.ceil(steps.length / cols);
    const sctx = sprite.getContext("2d");
    sctx.fillStyle = "#07070a";
    sctx.fillRect(0, 0, sprite.width, sprite.height);

    const flat = [];
    for (let index = 0; index < steps.length; index += 1) {
      const step = steps[index];
      const { canvas, flat: isFlat } = await frame(step.scene, step.look, step.colours);
      if (isFlat) flat.push(`${step.label} (flat)`);
      sctx.drawImage(canvas, (index % cols) * cellW, Math.floor(index / cols) * cellH);
    }

    return {
      data: sprite.toDataURL("image/jpeg", 0.78),
      cells: steps.length,
      rows: Math.ceil(steps.length / cols),
      labels: steps.map((step) => step.label),
      flat,
    };
  },
  { cellW: CELL_W, cellH: CELL_H, cols: COLS },
);

mkdirSync("public/film", { recursive: true });
const bytes = Buffer.from(result.data.split(",")[1], "base64");
writeFileSync("public/film/plate-film.jpg", bytes);
console.log(
  `film: ${result.cells} cells (${COLS}×${result.rows}) ${(bytes.length / 1024).toFixed(0)}KB -> public/film/plate-film.jpg`,
);
if (result.flat.length) console.log(`FLAT FRAMES (left empty): ${result.flat.join("; ")}`);
result.labels.forEach((label, index) => console.log(`  cell ${String(index).padStart(2, "0")}: ${label}`));
await browser.close();