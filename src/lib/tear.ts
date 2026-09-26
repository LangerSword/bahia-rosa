/**
 * The tear.
 *
 * The comparison between a photograph and its plate is a seam, and a seam with a ruler's edge reads like a
 * slider widget. A torn edge reads like paper: the plate was *torn away* from the original. This module
 * draws that edge as an SVG path — deterministic for a given seed, so the same tear is drawn on every render
 * and a test can assert it is a tear rather than a rule.
 */

/** Small deterministic PRNG (mulberry32) — no Math.random, so the tear is stable across renders. */
function wobble(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const TEAR_WIDTH = 34;
export const TEAR_JAGS = 30;

/**
 * A torn edge in a `TEAR_WIDTH`-wide, `height`-tall viewBox: down the centre with paper wobble either side of
 * it, always starting at the top and ending at the bottom so the tear spans the whole frame.
 *
 * The strip is wide (and the wobble deep) on purpose: at the size this edge is actually rendered — across a
 * thousand-pixel print — a narrow tear reads as a straight gold line, which is the one thing it must not be.
 */
export function tearPath(seed: number, height: number): string {
  const random = wobble(seed);
  const mid = TEAR_WIDTH / 2;
  const step = height / TEAR_JAGS;
  const points: Array<[number, number]> = [[mid, 0]];
  for (let index = 1; index < TEAR_JAGS; index += 1) {
    const y = step * index;
    const swing = (random() - 0.5) * (TEAR_WIDTH * 0.82);
    const x = Math.min(TEAR_WIDTH - 0.4, Math.max(0.4, mid + swing));
    points.push([x, y]);
  }
  points.push([mid, height]);
  return points.map(([x, y], index) => `${index === 0 ? "M" : "L"}${x.toFixed(2)},${y.toFixed(2)}`).join(" ");
}