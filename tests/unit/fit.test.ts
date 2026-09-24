import { describe, expect, it } from "vitest";
import { fitRect } from "../../src/world/compose";

/**
 * Fitting a photograph to a surface.
 *
 * The complaint that produced this: the payoff cropped the picture with no way to keep all of it. The
 * default is `contain` now — the whole frame fits, and the leftover space is drawn as a mount — with
 * `cover` kept as a per-download choice. Both are pure geometry, so both are checked here rather than
 * by eye: a crop that "looks fine" on one photograph is exactly how the last one shipped.
 *
 * The invariant that matters most is the obvious one: with `contain`, the drawn rectangle is *inside*
 * the target on both axes — which is the same statement as "nothing was cropped".
 */

const target = { x: 100, y: 50, w: 800, h: 600 };
const landscape = { width: 1600, height: 900 };
const portrait = { width: 900, height: 1600 };
const square = { width: 1000, height: 1000 };

describe("fitRect", () => {
  it("contain puts the whole photograph inside the rect, on both axes", () => {
    const placed = fitRect(landscape, target, "contain");

    expect(placed.x).toBeGreaterThanOrEqual(target.x - 0.001);
    expect(placed.y).toBeGreaterThanOrEqual(target.y - 0.001);
    expect(placed.x + placed.w).toBeLessThanOrEqual(target.x + target.w + 0.001);
    expect(placed.y + placed.h).toBeLessThanOrEqual(target.y + target.h + 0.001);
  });

  it("contain leaves the mount even on both sides", () => {
    const placed = fitRect(landscape, target, "contain");
    const left = placed.x - target.x;
    const right = target.x + target.w - (placed.x + placed.w);
    expect(left).toBeCloseTo(right, 6);
  });

  it("cover fills the rect, which means it overflows on one axis — that is the crop", () => {
    const placed = fitRect(portrait, target, "cover");
    expect(placed.w).toBeGreaterThanOrEqual(target.w - 0.001);
    expect(placed.h).toBeGreaterThanOrEqual(target.h - 0.001);
  });

  it("cover biases the overflow upward, so a portrait is not cut at the chin", () => {
    const placed = fitRect(portrait, target, "cover");
    // Both edges overflow *outside* the target, so their signed values are negative — what the bias
    // changes is how much is kept above versus cut below, which is a comparison of magnitudes.
    const keptAbove = Math.abs(placed.y - target.y);
    const cutBelow = Math.abs(target.y + target.h - (placed.y + placed.h));
    expect(keptAbove).toBeLessThan(cutBelow);
    // And the bias is the documented one, not an accident of the numbers.
    const overflow = placed.h - target.h;
    expect(keptAbove).toBeCloseTo(overflow * 0.4, 6);
  });

  it("neither fit ever distorts: the drawn rect keeps the photograph's own aspect", () => {
    for (const image of [landscape, portrait, square]) {
      for (const fit of ["cover", "contain"] as const) {
        const placed = fitRect(image, target, fit);
        expect(placed.w / placed.h, `${fit} ${image.width}x${image.height}`).toBeCloseTo(
          image.width / image.height,
          6,
        );
      }
    }
  });

  it("a square photograph in a wide surface is letterboxed, not stretched", () => {
    const placed = fitRect(square, target, "contain");
    expect(placed.h).toBeCloseTo(target.h, 6); // the limiting axis
    expect(placed.w).toBeCloseTo(target.h, 6);
    expect(placed.w).toBeLessThan(target.w); // and the mount shows on both sides
  });
});