/**
 * Where the paint's milliseconds go — measured, not guessed.
 *
 * Run: npx vite-node tools/paint-time.ts
 *
 * The press's wall-clock is spread across a fetch, a segmenter and this. This script only covers this: the
 * pixel work in styliseImageData, timed per lever, on the same 1280×720 frame fast paints. Set an option to
 * zero and see what it was costing. No canvas, no browser, no opinions.
 */

import { styliseImageData, FAST } from "../src/look/stylise";

const WIDTH = 1280;
const HEIGHT = 720;

/** A frame with structure at every scale: gradients, edges, fine texture — what a photograph has. */
const frame = (() => {
  const rgba = new Uint8ClampedArray(WIDTH * HEIGHT * 4);
  for (let y = 0; y < HEIGHT; y += 1) {
    for (let x = 0; x < WIDTH; x += 1) {
      const p = (y * WIDTH + x) * 4;
      const base = 40 + (y / HEIGHT) * 170;
      const wobble = 18 * Math.sin(x / 9) * Math.cos(y / 13);
      const edge = x > WIDTH * 0.4 && x < WIDTH * 0.62 ? -55 : 0;
      const texture = ((x * 7 + y * 13) % 29) - 14;
      const i = x * 16 + y * 24;
      rgba[p] = base + wobble + edge + texture + i;
      rgba[p + 1] = base * 0.86 + wobble * 0.5 + texture * 0.6 + i * 0.8;
      rgba[p + 2] = base * 0.62 + texture * 0.3;
      rgba[p + 3] = 255;
    }
  }
  return rgba;
})();

const time = (label: string, options: Record<string, number>) => {
  styliseImageData(frame, WIDTH, HEIGHT, options); // warm up, so the first run's allocation is not the story
  const runs = 3;
  let best = Infinity;
  for (let i = 0; i < runs; i += 1) {
    const start = performance.now();
    styliseImageData(frame, WIDTH, HEIGHT, options);
    best = Math.min(best, performance.now() - start);
  }
  console.log(`${label.padEnd(46)} ${best.toFixed(0).padStart(5)} ms`);
  return best;
};

const full = { ...FAST } as Record<string, number>;
console.log(`\nthe whole paint, as fast paints it (${WIDTH}×${HEIGHT}):`);
time("everything", full);

console.log("\nwhat each lever costs (the rest held still):");
for (const rounds of [0, 2, 4, 8]) {
  time(`palette rounds = ${rounds}`, { ...full, iterations: rounds });
}
time("smoothing off", { ...full, smooth: 0 });
time("paper/grain off", { ...full, paper: 0 });
time("ink off", { ...full, ink: 0 });
time("detail pass off", { ...full, detail: 0 });
time("palette blend off", { ...full, palette: 0 });

console.log("\nvariants that keep the look but might not cost the time:");
time("rounds on a stride-3 sample (see quantise)", { ...full, iterations: 8, seed: full.seed });