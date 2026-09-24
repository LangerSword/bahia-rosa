import { describe, expect, it } from "vitest";
import { shrinkMask } from "../../src/look/bodysegment";

/**
 * The cut's edge — the pale halo, as a number.
 *
 * A segmentation model's alpha is soft at the boundary, and those boundary pixels are a *mixture* of the
 * person and whatever stood behind them. On a real photograph the visitor read the result as "the people look
 * like stickers with a halo… a white background behind their heads and shoulders", which is exactly what a
 * mixture of a person and a bright wall looks like once it is painted and laid on a scene it was never in.
 *
 * `shrinkMask` erodes the alpha so the mixture is dropped and the person's own pixels carry the edge. This
 * measures that the mixed ring goes, that the interior does not move, and that the mask shrinks by the amount
 * it says on the tin — because an erosion that quietly ate a different number of pixels would be a bug that
 * looked like a feature.
 */

const WIDTH = 24;
const HEIGHT = 24;
const BLOCK_FROM = 6;
const BLOCK_TO = 18;
const FRINGE = 120;

/** A person's block at full alpha, ringed by one pixel of half-alpha mixture, on an empty field. */
const maskWithFringe = (): Uint8ClampedArray => {
  const alpha = new Uint8ClampedArray(WIDTH * HEIGHT);
  for (let y = 0; y < HEIGHT; y += 1) {
    for (let x = 0; x < WIDTH; x += 1) {
      const inside = x >= BLOCK_FROM && x <= BLOCK_TO && y >= BLOCK_FROM && y <= BLOCK_TO;
      const onFringe =
        x >= BLOCK_FROM - 1 && x <= BLOCK_TO + 1 && y >= BLOCK_FROM - 1 && y <= BLOCK_TO + 1;
      alpha[y * WIDTH + x] = inside ? 255 : onFringe ? FRINGE : 0;
    }
  }
  return alpha;
};

const at = (alpha: Uint8ClampedArray, x: number, y: number): number => alpha[y * WIDTH + x];

describe("the cut's edge", () => {
  it("drops the mixed ring and leaves the person alone", () => {
    const alpha = maskWithFringe();
    const cut = shrinkMask(alpha, WIDTH, HEIGHT, 2);

    // The boundary the model drew is where the mixture lived: it must be gone, not merely softened.
    expect(at(cut, BLOCK_FROM, 12), "the old boundary is still there").toBe(0);
    expect(at(cut, BLOCK_TO, 12), "the old boundary is still there").toBe(0);
    expect(at(cut, 12, BLOCK_FROM), "the old boundary is still there").toBe(0);

    // And the person's own pixels are untouched, ringed by the soft edge the upscale will smooth.
    expect(at(cut, 12, 12)).toBe(255);
    expect(at(cut, BLOCK_FROM + 2, BLOCK_FROM + 2)).toBe(255);
  });

  it("shrinks the mask by exactly the pixels it was asked for", () => {
    const alpha = maskWithFringe();
    const cut = shrinkMask(alpha, WIDTH, HEIGHT, 2);

    const reach = (source: Uint8ClampedArray): { from: number; to: number } => {
      let from = WIDTH;
      let to = -1;
      for (let x = 0; x < WIDTH; x += 1) {
        if (source[12 * WIDTH + x] > 0) {
          from = Math.min(from, x);
          to = Math.max(to, x);
        }
      }
      return { from, to };
    };

    const before = reach(alpha);
    const after = reach(cut);
    // One pixel of fringe on each side of the block, and the erosion brings the edge two further in — so the
    // reach shrinks by four in total, which is what "by two" has to mean on both sides at once.
    expect(before.to - before.from).toBe(BLOCK_TO - BLOCK_FROM + 2);
    expect(after.to - after.from).toBe(BLOCK_TO - BLOCK_FROM - 2);
  });

  it("is a no-op when asked for nothing, so an unasked-for press is unchanged", () => {
    const alpha = maskWithFringe();
    const same = shrinkMask(alpha, WIDTH, HEIGHT, 0);
    expect(Array.from(same)).toEqual(Array.from(alpha));
  });
});