import { describe, expect, it } from "vitest";
import { unsharpMask } from "../../src/look/stylise";

/**
 * The unsharp mask, for photographs smaller than the frame they are painted into.
 *
 * A pasted screenshot is often 600 or 800 pixels wide and the subject is painted at a 900–1200px edge, so
 * the resample is an enlargement and the result reads as a smear. This measures what the mask actually does
 * to an edge: it must make it *more* of an edge, must not push anything out of range, and must be an exact
 * identity when the amount is zero — because a photograph that was already big enough must be untouched.
 */

/** A soft edge: a ramp two pixels wide between two flat fields. */
function softEdge(width: number, height: number, rampAt: number): Uint8ClampedArray {
  const rgba = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const p = (y * width + x) * 4;
      const t = Math.min(1, Math.max(0, (x - rampAt) / 2));
      const value = 60 + t * 150;
      rgba[p] = value;
      rgba[p + 1] = value;
      rgba[p + 2] = value;
      rgba[p + 3] = 255;
    }
  }
  return rgba;
}

/**
 * The steepest gradient anywhere across the edge, in one row.
 *
 * A single pair of pixels was the first attempt and it measured nothing: an unsharp mask moves the pixels
 * *beside* an edge more than the two the eye reads as the edge, so a fixed pair can straddle the change and
 * report the same number twice. The steepest gradient over a window is what "more of an edge" actually means.
 */
function edgeSteepness(pixels: Uint8ClampedArray, width: number, from: number, to: number): number {
  const row = 4 * width;
  let steepest = 0;
  for (let x = from; x <= to; x += 1) {
    steepest = Math.max(steepest, Math.abs(pixels[(row + x + 1) * 4] - pixels[(row + x - 1) * 4]));
  }
  return steepest;
}

describe("the unsharp mask", () => {
  it("makes a soft edge steeper without leaving the range", () => {
    const width = 24;
    const height = 8;
    const before = softEdge(width, height, 11);
    const after = unsharpMask(before, width, height, 0.6);

    const steepBefore = edgeSteepness(before, width, 8, 14);
    const steepAfter = edgeSteepness(after, width, 8, 14);
    expect(steepAfter).toBeGreaterThan(steepBefore);

    for (let i = 0; i < after.length; i += 1) {
      expect(after[i]).toBeGreaterThanOrEqual(0);
      expect(after[i]).toBeLessThanOrEqual(255);
    }
  });

  it("is an exact identity at amount zero", () => {
    const source = softEdge(12, 4, 5);
    const out = unsharpMask(source, 12, 4, 0);
    expect(Array.from(out)).toEqual(Array.from(source));
  });

  it("leaves flat areas alone", () => {
    const width = 12;
    const height = 4;
    const flat = new Uint8ClampedArray(width * height * 4).fill(120);
    for (let p = 3; p < flat.length; p += 4) flat[p] = 255;
    const out = unsharpMask(flat, width, height, 0.9);
    // A flat field has no detail to restore, so nothing moves — which is what stops the mask adding noise
    // to the quiet parts of a photograph.
    expect(out[4 * 5]).toBe(120);
    expect(out[4 * 6]).toBe(120);
  });
});
