import { describe, expect, it } from "vitest";
import { FAST, FINE, LOOKS, styliseImageData } from "../../src/look/stylise";

/**
 * The finish, as a measurable claim.
 *
 * "Better colour accuracy" is the kind of sentence a product writes and nobody checks. It is checkable:
 * run the same frame through the press with the look alone and with the look plus the fine colour work,
 * and count how many distinct colours come out. Fine more colours in the palette and pulls the frame
 * toward them more gently, so it keeps more of the photograph — while still being a painting, which is
 * the other half of the claim and needs its own assertion, because "keeps more colour" could be
 * satisfied by doing nothing at all.
 */

/** A frame with a wide range of colour in it, the way a photograph has. */
function photoFrame(size: number): Uint8ClampedArray {
  const data = new Uint8ClampedArray(size * size * 4);
  let p = 0;
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const t = x / size;
      const u = y / size;
      data[p] = 40 + 180 * t;
      data[p + 1] = 60 + 160 * u;
      data[p + 2] = 200 - 120 * t * u;
      data[p + 3] = 255;
      p += 4;
    }
  }
  return data;
}

function distinct(pixels: Uint8ClampedArray): number {
  const seen = new Set<number>();
  for (let i = 0; i < pixels.length; i += 4) {
    seen.add((pixels[i] << 16) | (pixels[i + 1] << 8) | pixels[i + 2]);
  }
  return seen.size;
}

const SIZE = 96;
const measure = (options: Parameters<typeof styliseImageData>[3]): number =>
  // Grain and paper off: both add variation on purpose, and neither is what "colour accuracy" means.
  distinct(styliseImageData(photoFrame(SIZE), SIZE, SIZE, { ...LOOKS.golden.options, finish: 0, paper: 0, ...options }));

describe("the finish", () => {
  it("fine keeps more of the photograph's own colour than fast", () => {
    expect(measure({ ...FINE })).toBeGreaterThan(measure({ ...FAST }));
  });

  it("the two finishes differ enough to see, not just in the count of colours", () => {
    // The complaint was "fast and fine look the same to me", which is the failure mode this whole
    // setting has to avoid: a control that changes a number and nothing else is theatre. So the average
    // per-channel difference is measured and held to a floor — a finish nobody can see is a bug.
    const frame = photoFrame(SIZE);
    const fast = styliseImageData(frame, SIZE, SIZE, { ...LOOKS.golden.options, ...FAST, finish: 0, paper: 0 });
    const fine = styliseImageData(frame, SIZE, SIZE, { ...LOOKS.golden.options, ...FINE, finish: 0, paper: 0 });

    let total = 0;
    for (let i = 0; i < fast.length; i += 4) {
      total += Math.abs(fast[i] - fine[i]) + Math.abs(fast[i + 1] - fine[i + 1]) + Math.abs(fast[i + 2] - fine[i + 2]);
    }
    const meanAbs = total / (fast.length / 4) / 3;
    expect(meanAbs, `the finishes differ by only ${meanAbs.toFixed(1)}/255 on average`).toBeGreaterThan(8);
  });

  it("is still a painting: the palette still collapses the frame", () => {
    // Without this, "keeps more colour" would be satisfied by a no-op.
    expect(measure({ ...FINE })).toBeLessThan(distinct(photoFrame(SIZE)));
  });

  it("overrides the look's colour work and leaves its mood alone", () => {
    for (const preset of [FAST, FINE]) {
      expect(preset.tone).toBeUndefined();
      expect(preset.light).toBeUndefined();
      expect(preset.finish).toBeUndefined();
    }
    expect(FINE.colours).toBeGreaterThan(FAST.colours ?? 0);
    expect(FINE.palette ?? 1).toBeLessThan(FAST.palette ?? 1);
    expect(FAST.colours).toBeLessThan(LOOKS.golden.options.colours ?? 0);
  });
});