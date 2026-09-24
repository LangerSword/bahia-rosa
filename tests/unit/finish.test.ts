import { describe, expect, it } from "vitest";
import { FINE, LOOKS, styliseImageData } from "../../src/look/stylise";

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
  it("keeps more of the photograph's own colour than the look alone", () => {
    expect(measure({ ...FINE })).toBeGreaterThan(measure({}));
  });

  it("is still a painting: the palette still collapses the frame", () => {
    // Without this, "keeps more colour" would be satisfied by a no-op.
    expect(measure({ ...FINE })).toBeLessThan(distinct(photoFrame(SIZE)));
  });

  it("overrides the look's colour work and leaves its mood alone", () => {
    expect(FINE.tone).toBeUndefined();
    expect(FINE.light).toBeUndefined();
    expect(FINE.finish).toBeUndefined();
    expect(FINE.colours).toBeGreaterThan(LOOKS.golden.options.colours ?? 0);
    expect(FINE.palette ?? 1).toBeLessThan(LOOKS.golden.options.palette ?? 1);
    expect(FINE.ink).toBeLessThan(LOOKS.golden.options.ink ?? 1);
  });
});