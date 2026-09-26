/**
 * Build the welcome screen's film: the press redrawing one plate, then every plate in the gallery, fast.
 *
 * The frames are not drawn by this script. It opens the dev server and calls the same `portraitFromImage` the
 * visitor's photograph goes through — first its *layers* (the photograph, the ground the press reads, the
 * subject it cuts), then the canvas at rising fidelity — and lays the outputs, plus every plate the gallery
 * ships, into one sprite of 576×324 cells. One file, one request, and the film on the title sheet is the
 * press's own pipeline rather than a picture of it.
 *
 * The plate list comes from `src/lib/gallery.ts`, so the film's second half cannot drift from the gallery.
 *
 *   node tools/make-film.mjs        # needs the dev server (npm run dev) on :5178
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { chromium } from "playwright";

const BASE = process.env.SHOT_BASE ?? "http://localhost:5178";
const CELL_W = 576;
const CELL_H = 324;
const COLS = 6;
/**
 * The film's subject is the one photograph the gallery itself ships — its "as it arrived" frame. A real
 * photograph, not an illustration: the press's segmentation is built for photographs, and on drawn art it
 * returns a hairline of the subject and calls it a person. It is in the repo, credited, and public.
 */
const DEMO = "plates/one-photograph-original.jpg";

/** The gallery's own list of frames, read out of the module that owns it. */
function gallerySources() {
  const text = readFileSync("src/lib/gallery.ts", "utf8");
  const found = [...text.matchAll(/asset\("([^"]+)"\)/g)].map((match) => match[1]);
  if (found.length < 5) throw new Error(`only ${found.length} frames found in src/lib/gallery.ts`);
  return found;
}

const frames = gallerySources();

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 960, height: 640 } });
page.on("pageerror", (error) => console.error("page error:", error.message));
await page.goto(BASE, { waitUntil: "domcontentloaded" });
await page.waitForFunction(
  "window.__press && typeof window.__press.portraitFromImage === 'function'",
  null,
  { timeout: 30000 },
);

const result = await page.evaluate(
  async ({ demo, frames, cellW, cellH, cols }) => {
    const press = window.__press;
    const load = (src) =>
      new Promise((resolve, reject) => {
        const image = new Image();
        image.onload = () => resolve(image);
        image.onerror = () => reject(new Error(`could not load ${src}`));
        image.src = src;
      });

    const sceneFrames = press.SCENE_IDS.map((id) => press.sceneSrc(id)).filter(Boolean);
    const cells = 9 + frames.length + sceneFrames.length;
    const sprite = document.createElement("canvas");
    sprite.width = cellW * cols;
    sprite.height = cellH * Math.ceil(cells / cols);
    const ctx = sprite.getContext("2d");
    ctx.fillStyle = "#07070a";
    ctx.fillRect(0, 0, sprite.width, sprite.height);

    let index = 0;
    const blanks = [];
    const paint = (source, what) => {
      const x = (index % cols) * cellW;
      const y = Math.floor(index / cols) * cellH;
      // Cover-fit: the press's output is not exactly 16:9, and a letterbox inside a mat looks like a bug.
      const sw = source.width ?? source.naturalWidth;
      const sh = source.height ?? source.naturalHeight;
      const scale = Math.max(cellW / sw, cellH / sh);
      const dw = sw * scale;
      const dh = sh * scale;
      ctx.drawImage(source, x + (cellW - dw) / 2, y + (cellH - dh) / 2, dw, dh);
      // A frame that is a flat colour is a frame that failed: sample it, and leave it out rather than
      // shipping a black cell that a visitor will read as broken.
      const probe = document.createElement("canvas");
      probe.width = 32;
      probe.height = 18;
      const pctx = probe.getContext("2d");
      pctx.drawImage(source, 0, 0, 32, 18);
      const data = pctx.getImageData(0, 0, 32, 18).data;
      let lo = 255;
      let hi = 0;
      for (let i = 0; i < data.length; i += 4) {
        const luma = data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114;
        lo = Math.min(lo, luma);
        hi = Math.max(hi, luma);
      }
      const flat = hi - lo < 6;
      if (flat) {
        blanks.push(`${what} (flat)`);
      } else {
        index += 1;
        return;
      }
      // Leave the cell empty: the player only reads the frames the tool kept, so the count goes back.
      ctx.fillStyle = "#07070a";
      ctx.fillRect(x, y, cellW, cellH);
    };

    const photo = await load(demo);
    paint(photo, "the photograph as it arrived");

    const base = press.LOOKS.dusk.options;
    // The press's own layers, at the finish the press will print: the ground it reads, then the subject it cuts.
    const final = await press.portraitFromImage(photo, { ...base, colours: 32 });
    if (!(final.ground instanceof HTMLCanvasElement) || !(final.subject instanceof HTMLCanvasElement)) {
      throw new Error(`the press no longer exposes ground/subject: ${Object.keys(final).join(", ")}`);
    }
    paint(final.ground, "the ground the press reads");
    paint(final.subject, "the subject the press cuts");

    // Then the same canvas at rising fidelity, three colours to thirty-two: the flattening, fast.
    for (const colours of [3, 5, 8, 12, 20, 32]) {
      const out = await press.portraitFromImage(photo, { ...base, colours });
      paint(out.canvas, `the canvas at ${colours} colours`);
    }

    // Then every plate the gallery ships — the printed ones from the module above, and the four places the
    // press prints into, taken from the app's own scene list so the film cannot drift from the gallery.
    for (const src of [...frames, ...sceneFrames]) paint(await load(src), src);

    return {
      data: sprite.toDataURL("image/jpeg", 0.78),
      cells: index,
      rows: Math.ceil(index / cols),
      blanks,
    };
  },
  { demo: DEMO, frames, cellW: CELL_W, cellH: CELL_H, cols: COLS },
);

mkdirSync("public/film", { recursive: true });
const bytes = Buffer.from(result.data.split(",")[1], "base64");
writeFileSync("public/film/plate-film.jpg", bytes);
console.log(
  `film: ${result.cells} cells (${COLS}×${result.rows}) ${(bytes.length / 1024).toFixed(0)}KB -> public/film/plate-film.jpg`,
);
await browser.close();