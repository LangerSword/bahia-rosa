import { describe, expect, test } from "vitest";
import { median3, median9, posterize } from "../../src/lib/portrait/toon";

/**
 * These are the game's visual rules, so they get covered first (plan Session B, Task B3).
 */

describe("posterize", () => {
  test("keeps the ends of the range", () => {
    expect(posterize(0, 4)).toBe(0);
    expect(posterize(255, 4)).toBe(255);
  });

  test("collapses neighbouring values into the same step", () => {
    expect(posterize(100, 4)).toBe(posterize(110, 4));
    expect(posterize(100, 4)).toBe(85);
  });

  test("is a no-op below two levels", () => {
    expect(posterize(123, 1)).toBe(123);
  });
});

describe("median9", () => {
  test("returns the middle value", () => {
    expect(median9([9, 1, 8, 2, 7, 3, 6, 4, 5])).toBe(5);
  });

  test("ignores a single outlier", () => {
    expect(median9([10, 10, 10, 10, 255, 10, 10, 10, 10])).toBe(10);
  });
});

describe("median3", () => {
  test("removes a single-pixel speck", () => {
    const img = new ImageData(3, 3);
    for (let p = 0; p < 9; p++) {
      img.data[p * 4 + 0] = 10;
      img.data[p * 4 + 1] = 10;
      img.data[p * 4 + 2] = 10;
      img.data[p * 4 + 3] = 255;
    }
    const centre = (1 * 3 + 1) * 4;
    img.data[centre] = 255;
    img.data[centre + 1] = 255;
    img.data[centre + 2] = 255;

    const out = median3(img);
    expect(out.data[centre]).toBe(10);
    expect(out.data[centre + 1]).toBe(10);
    expect(out.data[centre + 2]).toBe(10);
  });

  test("preserves alpha and dimensions", () => {
    const img = new ImageData(4, 2);
    img.data.fill(200);
    const out = median3(img);
    expect(out.width).toBe(4);
    expect(out.height).toBe(2);
    expect(out.data[3]).toBe(200);
  });
});
