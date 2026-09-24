import { describe, expect, it } from "vitest";
import { cleanMask } from "../../src/look/bodysegment";

/**
 * The model's classes are not a mask yet.
 *
 * MediaPipe answers per pixel — background, hair, body-skin, face-skin, clothes, accessory — and that
 * answer arrives speckled: a chair classed as hair, a dark shirt classed as background, a poster on the
 * wall classed as a second person. These tests are the cleanup contract, on synthetic class maps whose
 * right answer is known, because the model itself cannot be run in a unit test and the cleanup is where
 * a cut-out quietly turns into a silhouette full of holes.
 */

const BACKGROUND = 0;
const HAIR = 1;
const CLOTHES = 4;

function blank(width: number, height: number, value = BACKGROUND): Uint8Array {
  return new Uint8Array(width * height).fill(value);
}

/** A filled rectangle of a class, in an otherwise empty map. */
function fill(
  map: Uint8Array,
  width: number,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  value: number,
): void {
  for (let y = y0; y <= y1; y += 1) {
    for (let x = x0; x <= x1; x += 1) map[y * width + x] = value;
  }
}

describe("cleanMask", () => {
  it("keeps the person and drops the speckle", () => {
    const width = 40;
    const height = 40;
    const map = blank(width, height);
    fill(map, width, 10, 8, 24, 34, CLOTHES); // the person
    fill(map, width, 33, 4, 35, 6, HAIR); // a chair across the room, classed as hair

    const { alpha, box, share } = cleanMask(map, width, height);

    // The speckle is gone: one component survives, so nothing is painted outside the person's box.
    expect(alpha[5 * width + 34]).toBe(0);
    expect(box).toEqual({ x: 10, y: 8, width: 15, height: 27 });
    expect(share).toBeCloseTo((15 * 27) / (width * height), 3);
    expect(alpha[20 * width + 15]).toBe(255);
  });

  it("fills a hole the model left inside the person", () => {
    const width = 30;
    const height = 30;
    const map = blank(width, height);
    fill(map, width, 5, 5, 24, 24, CLOTHES);
    fill(map, width, 12, 12, 18, 18, BACKGROUND); // a dark shirt read as background

    const { alpha, share } = cleanMask(map, width, height);

    expect(alpha[15 * width + 15]).toBe(255); // the hole belongs to the subject
    expect(share).toBeCloseTo((20 * 20) / (30 * 30), 3);
  });

  it("keeps the background outside the subject open", () => {
    const width = 30;
    const height = 30;
    const map = blank(width, height);
    fill(map, width, 8, 8, 20, 20, CLOTHES);

    const { alpha } = cleanMask(map, width, height);

    expect(alpha[0]).toBe(0);
    expect(alpha[29 * width + 29]).toBe(0);
  });

  it("reports an empty frame as an empty frame instead of a subject", () => {
    const width = 16;
    const height = 16;
    const { alpha, share, box } = cleanMask(blank(width, height), width, height);

    expect(share).toBe(0);
    expect(alpha.every((value) => value === 0)).toBe(true);
    expect(box).toEqual({ x: 0, y: 0, width, height });
  });

  it("takes the largest of two competing subjects", () => {
    const width = 50;
    const height = 50;
    const map = blank(width, height);
    fill(map, width, 2, 2, 12, 12, CLOTHES); // a poster on the wall
    fill(map, width, 20, 10, 44, 46, HAIR); // the person

    const { box } = cleanMask(map, width, height);

    expect(box).toEqual({ x: 20, y: 10, width: 25, height: 37 });
  });
});