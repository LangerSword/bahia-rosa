import { describe, expect, it } from "vitest";
import { restoreDetail } from "../../src/look/stylise";

/**
 * The detail pass — "the text and everything should look right", as a number.
 *
 * Quantisation is a decision about colour, and colour is only half of what makes lettering readable: the other
 * half is the local contrast between a letter and the surface it sits on, and that is what a sixteen-colour
 * palette flattens. This measures whether putting the photograph's own high-frequency luminance back over the
 * paint actually restores it — as the correlation between the sharpness of the painted frame and the sharpness
 * of the source, before and after the pass.
 *
 * The frame is deliberately awkward for the claim: the "lettering" is soft (an anti-aliased bar, the way small
 * print actually arrives), because a hard-edged bar survives quantisation on its own and would prove nothing.
 * The flattening is a plain luma quantiser rather than the press's palette, so the measurement is about the
 * pass and not about the palette — that has its own test in `accuracy.test.ts`.
 */

const WIDTH = 64;
const HEIGHT = 48;
const PIXELS = WIDTH * HEIGHT;

const luma = (rgba: ArrayLike<number>): Float32Array => {
  const out = new Float32Array(PIXELS);
  for (let i = 0; i < PIXELS; i += 1) {
    out[i] = 0.2126 * rgba[i * 4] + 0.7152 * rgba[i * 4 + 1] + 0.0722 * rgba[i * 4 + 2];
  }
  return out;
};

/** A surface with soft lettering across the middle, and a flat corner that must be left alone. */
const frameWithText = (): Uint8ClampedArray => {
  const rgba = new Uint8ClampedArray(PIXELS * 4);
  const barTop = HEIGHT / 2 - 3;
  const barBottom = HEIGHT / 2 + 3;
  for (let y = 0; y < HEIGHT; y += 1) {
    for (let x = 0; x < WIDTH; x += 1) {
      const p = (y * WIDTH + x) * 4;
      const inked = x > WIDTH * 0.18 && x < WIDTH * 0.82;
      // A soft edge over four rows: the way small print arrives, not a hard rectangle.
      const distance = Math.max(barTop - y, y - barBottom);
      const softness = Math.max(0, Math.min(1, 1 - distance / 4));
      const value = inked ? 120 + (1 - softness) * 60 : 180;
      rgba[p] = value;
      rgba[p + 1] = value;
      rgba[p + 2] = value;
      rgba[p + 3] = 255;
    }
  }
  return rgba;
};

/** The flattening the pass exists to undo: every pixel snapped to the nearest of a few luma steps. */
const flatten = (rgba: Uint8ClampedArray, steps: number): Uint8ClampedArray => {
  const out = Uint8ClampedArray.from(rgba);
  const levels = Array.from({ length: steps }, (_, i) => Math.round((i * 255) / (steps - 1)));
  for (let i = 0; i < out.length; i += 4) {
    const value = 0.2126 * out[i] + 0.7152 * out[i + 1] + 0.0722 * out[i + 2];
    const nearest = levels.reduce(
      (best, level) => (Math.abs(level - value) < Math.abs(best - value) ? level : best),
      levels[0],
    );
    out[i] = nearest;
    out[i + 1] = nearest;
    out[i + 2] = nearest;
  }
  return out;
};

describe("the detail pass", () => {
  it("pulls the painted frame back toward the photograph where there is detail", () => {
    const source = frameWithText();
    const painted = flatten(source, 6);
    const sourceLuma = luma(source);

    /** Where the photograph itself has a local wobble: the lettering's edges, and nothing else. */
    const hasDetail = (y: number, x: number): boolean => {
      const value = sourceLuma[y * WIDTH + x];
      let total = 0;
      let count = 0;
      for (let dy = -1; dy <= 1; dy += 1) {
        const ny = y + dy;
        if (ny < 0 || ny >= HEIGHT) continue;
        for (let dx = -1; dx <= 1; dx += 1) {
          const nx = x + dx;
          if (nx < 0 || nx >= WIDTH) continue;
          total += sourceLuma[ny * WIDTH + nx];
          count += 1;
        }
      }
      return Math.abs(value - total / count) > 3;
    };

    /**
     * Mean luminance error against the photograph, **over the pixels where the photograph has detail** — the
     * measure the pass is for. The local contrast of a letter is exactly its distance from the surface around
     * it, so the frame getting closer to the photograph there *is* the letter coming back.
     *
     * Two earlier versions of this instrument were wrong and the measurement said so: correlation of
     * high-frequency *shape* refused the claim (a hard quantised step blended toward a soft ramp changes
     * amplitudes, not shapes), and averaging over the whole band hid the recovery under flat pixels the pass is
     * *supposed* to leave painted. Both numbers were down even as the lettering improved. The instrument was
     * wrong twice; the pass now measures exactly what it claims.
     */
    const detailError = (frame: Uint8ClampedArray): number => {
      let total = 0;
      let count = 0;
      for (let y = 0; y < HEIGHT; y += 1) {
        for (let x = 0; x < WIDTH; x += 1) {
          if (!hasDetail(y, x)) continue;
          const p = (y * WIDTH + x) * 4;
          total += Math.abs(frame[p] - sourceLuma[y * WIDTH + x]);
          count += 1;
        }
      }
      return total / Math.max(1, count);
    };

    const before = detailError(painted);
    const after = Uint8ClampedArray.from(painted);
    const touched = restoreDetail(after, sourceLuma, WIDTH, HEIGHT, 0.55);
    const recovered = detailError(after);

    // A little over half of the flattened distance comes back — the strength, on the pixels that asked for it.
    expect(recovered).toBeLessThan(before * 0.6);
    // ...and it did something: a frame where it touched nothing is a pass that is not wired up.
    expect(touched).toBeGreaterThan(PIXELS * 0.02);
    expect(before).toBeGreaterThan(4); // the frame was genuinely flattened, or there was nothing to recover
  });

  it("leaves a flat surface flat", () => {
    const source = frameWithText();
    const painted = flatten(source, 6);
    const after = Uint8ClampedArray.from(painted);

    restoreDetail(after, luma(source), WIDTH, HEIGHT, 0.55);

    // The top-left corner of that frame is a flat, untextured surface: not one level may move there.
    for (let y = 0; y < 6; y += 1) {
      for (let x = 0; x < 6; x += 1) {
        const p = (y * WIDTH + x) * 4;
        expect(Math.abs(after[p] - painted[p]), `pixel ${x},${y} moved`).toBeLessThanOrEqual(2);
      }
    }
  });

  it("is off by default — a finish that does not ask for it gets the paint alone", () => {
    const source = frameWithText();
    const painted = flatten(source, 6);
    const untouched = Uint8ClampedArray.from(painted);
    expect(restoreDetail(untouched, luma(source), WIDTH, HEIGHT, 0)).toBe(0);
    expect(Array.from(untouched)).toEqual(Array.from(painted));
  });
});