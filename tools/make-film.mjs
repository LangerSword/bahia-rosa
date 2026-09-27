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
const CELL_W = 1600;
const CELL_H = 900;
const COLS = 6;

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

    /**
     * The scene, cover-fit, then the plate's layers added one at a time — all through the press's own
     * functions. `layer` is the part of the press's preset that a frame has done to it: a colour count, and
     * the ink, detail and paper knobs, so each frame is the plate *with one more pass* rather than a blurrier
     * version of the same picture. Zero means the pass has not happened yet.
     */
    async function frame(step) {
      // A figure: a real photograph of a person, through the *press* — the same call the visitor's own photo
      // goes through, so the plate is not a special case. The press hands back its own canvas, cover-fitted.
      if (step.figure) {
        const photo = await load(`film-src/${step.figure}`);
        /**
         * Normalise every figure to one aspect first — 16:9, which is what the press composes in. That is
         * measured, not assumed: a 3:4 source and a 16:9 source both come back 1900×1069, so the plate's
         * frame is the press's own and the only thing the source aspect controls is how the subject is
         * framed *inside* it. Preparing at the plate's own aspect is therefore what "all the same aspect
         * ratio" has to mean, and the source is prepared large (2400 wide) so the plate's 1900 is a
         * downscale — the sharpest direction — rather than an upscale.
         */
        const prep = document.createElement("canvas");
        prep.width = 2400;
        prep.height = 1350;
        const pctx2 = prep.getContext("2d", { willReadFrequently: true });
        pctx2.fillStyle = "#1a1a1e";
        pctx2.fillRect(0, 0, prep.width, prep.height);
        const ps = Math.min(prep.width / photo.naturalWidth, prep.height / photo.naturalHeight) * 0.8;
        const pw = photo.naturalWidth * ps;
        const ph = photo.naturalHeight * ps;
        pctx2.drawImage(photo, (prep.width - pw) / 2, (prep.height - ph) / 2, pw, ph);
        /**
         * And pressed the *composite* way: the figure set into the city at the beat's hour, at fine quality
         * and the app's own as-is ceiling. `wholeFrame` is deliberately *off* — on, the press returns the
         * photograph pressed in its own frame with no city at all, which is right for the as-is button and
         * wrong for a cast roll. Because the source is already the cell's aspect, the plate comes back at
         * that aspect and drops into the cell one to one.
         */
        const out = await press.portraitFromImage(prep, {
          ...(press.LOOKS[step.look ?? "night"]?.options ?? preset),
          fine: true,
          maxSize: 1900,
          scene: "boulevard",
        });
        if (!(out?.canvas instanceof HTMLCanvasElement)) {
          throw new Error(`figure ${step.figure}: the press returned no canvas`);
        }
        // The aspect contract, enforced rather than assumed: the press composes 16:9 plates — measured, not
        // guessed — so a plate that comes back in any other frame is a bug to fix rather than a crop to hide.
        const rel = out.canvas.width / out.canvas.height / (cellW / cellH);
        if (Math.abs(rel - 1) > 0.01) {
          throw new Error(`figure ${step.figure}: press returned ${out.canvas.width}x${out.canvas.height}, not the 16:9 frame its plates compose in`);
        }
        wctx.clearRect(0, 0, cellW, cellH);
        // The scene at the same hour, underneath, so the (never-expected) letterbox is the picture
        // continuing rather than a black bar — and then the plate, contained, so nothing is ever cropped.
        const backing = await load(press.sceneSrc("boulevard"));
        const bs = Math.max(cellW / backing.naturalWidth, cellH / backing.naturalHeight);
        wctx.drawImage(
          backing,
          (cellW - backing.naturalWidth * bs) / 2,
          (cellH - backing.naturalHeight * bs) / 2,
          backing.naturalWidth * bs,
          backing.naturalHeight * bs,
        );
        if (step.look) {
          const field = wctx.getImageData(0, 0, cellW, cellH);
          wctx.putImageData(new ImageData(press.gradePixels(field.data, press.gradeFor(step.look)), cellW, cellH), 0, 0);
        }
        const fit = Math.min(cellW / out.canvas.width, cellH / out.canvas.height);
        const dw = out.canvas.width * fit;
        const dh = out.canvas.height * fit;
        wctx.drawImage(out.canvas, (cellW - dw) / 2, (cellH - dh) / 2, dw, dh);
        return { canvas: working, flat: false };
      }
      const image = await load(press.sceneSrc(step.scene));
      const scale = Math.max(cellW / image.naturalWidth, cellH / image.naturalHeight);
      const dw = image.naturalWidth * scale;
      const dh = image.naturalHeight * scale;
      wctx.drawImage(image, (cellW - dw) / 2, (cellH - dh) / 2, dw, dh);
      let data = wctx.getImageData(0, 0, cellW, cellH);
      if (step.look) {
        const graded = press.gradePixels(data.data, press.gradeFor(step.look));
        data = new ImageData(graded, cellW, cellH);
      }
      if (step.layer) {
        // The press takes a pixel array and hands one back: passing the ImageData wrapper reads `undefined`
        // as its length and returns nothing at all.
        const out = press.styliseImageData(data.data, cellW, cellH, { ...preset, ...step.layer });
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

    /**
     * The build is the plate's own layers, in the press's order — the drawing, the hour, the flat shapes, the
     * ink lines, the detail, the fuller palette, and finally the plate with its paper. The ink and detail
     * values are scaled *from the press's own preset*, so they mean the same thing whatever units it uses.
     */
    const ink = (preset.ink ?? 0.5) * 1.35;
    const detail = (preset.detail ?? 0.5) * 1.15;
    const steps = [
      /**
       * The build: four of the press's own layers, in the press's order, so the film opens on a plate being
       * *drawn* rather than on a finished picture. Four, not seven: this is a cast roll now, and the city's
       * drawing only needs enough room to say what the press does.
       */
      { scene: "beach", look: null, layer: null, label: "the city's own drawing" },
      {
        scene: "beach",
        look: "dusk",
        layer: { colours: 6, ink: 0, detail: 0, paper: 0 },
        label: "the flat shapes",
      },
      {
        scene: "beach",
        look: "dusk",
        layer: { colours: 6, ink, detail: 0, paper: 0 },
        label: "the ink lines",
      },
      { scene: "beach", look: "dusk", layer: { colours: 20 }, label: "the plate — with its paper" },
      /**
       * And then the cast — eight real people, every one of them an actual photograph pressed through the
       * *same* call any visitor's photograph goes through (`portraitFromImage`), because the plates are not
       * special-cased. All eight are anonymous adults, all from colour sources, from Wikimedia Commons under
       * CC0 / CC BY / public domain, credited under the film and in docs/samples/CREDITS.md.
       *
       * Three classes of photograph were ruled out, and they are the three that always come up: named
       * celebrities (personality rights do not travel with a Commons licence), greyscale sources (a
       * black-and-white photograph cannot take a golden or neon grade and reads as a cold outlier), and any
       * photograph of a minor. What is left is a cast a city this size would actually have: the rapper, the
       * boxer, the biker, the runner, the guitarist, the skater, the sentinel, the busker.
       */
      { figure: "figure-rapper.jpg", look: "night", label: "the rapper, in the neon" },
      { figure: "figure-boxer.jpg", look: "night", label: "the boxer, in the neon" },
      { figure: "figure-biker.jpg", look: "golden", label: "the biker, leaving" },
      { figure: "figure-runner.jpg", look: "golden", label: "a runner on the beach" },
      { figure: "figure-stage.jpg", look: "night", label: "the guitarist, mid-song" },
      { figure: "figure-skater.jpg", look: "golden", label: "a skater, weightless" },
      { figure: "figure-sentinel.jpg", look: "night", label: "a sentinel at night" },
      { figure: "figure-busker.jpg", look: "night", label: "the busker, on the corner" },
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
      const { canvas, flat: isFlat } = await frame(step);
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