import { describe, expect, it } from "vitest";
import { GALLERY, splitColumns } from "../../src/lib/gallery";

/**
 * The plates are content, and content is where a gallery lies quietly: a stock frame, a missing caption, a
 * duplicated source, a place that is not actually offered. These tests hold the claims the section makes.
 */
describe("the plates", () => {
  it("shows nine frames — five printed plates and the four places the press prints into", () => {
    expect(GALLERY).toHaveLength(9);
  });

  it("every frame says what it is, and says it in a sentence", () => {
    for (const frame of GALLERY) {
      expect(frame.caption.length, frame.src).toBeGreaterThan(24);
      expect(frame.caption, frame.src).not.toMatch(/^(image|photo|picture|untitled|placeholder)/i);
    }
  });

  it("every frame carries its true pixel size, so the wall cannot shift as it loads", () => {
    for (const frame of GALLERY) {
      expect(frame.width, frame.src).toBeGreaterThan(300);
      expect(frame.height, frame.src).toBeGreaterThan(300);
      expect(Number.isInteger(frame.width) && Number.isInteger(frame.height), frame.src).toBe(true);
    }
  });

  it("draws every frame from one source each, and from this origin", () => {
    const sources = GALLERY.map((frame) => frame.src);
    expect(new Set(sources).size).toBe(sources.length);
    for (const src of sources) {
      expect(src).toMatch(/\.(jpg|jpeg|png|webp)$/i);
      expect(src.startsWith("/") || src.startsWith("http"), src).toBe(true);
    }
  });

  it("never advertises a place the picker does not offer", () => {
    // The mall plate exists in the repo but is deliberately withheld from the picker; a gallery that showed
    // it would promise a place the visitor cannot choose.
    expect(GALLERY.some((frame) => frame.src.includes("mall"))).toBe(false);
  });

  it("deals the frames one at a time so the columns stay balanced", () => {
    const items = [1, 2, 3, 4, 5, 6, 7, 8, 9];
    expect(splitColumns(items, 3)).toEqual([
      [1, 4, 7],
      [2, 5, 8],
      [3, 6, 9],
    ]);
    expect(splitColumns(items, 2)).toEqual([
      [1, 3, 5, 7, 9],
      [2, 4, 6, 8],
    ]);
    expect(splitColumns(items, 1)).toEqual([items]);
  });

  it("survives a nonsense column count instead of throwing on a zero-column grid", () => {
    expect(splitColumns([1, 2], 0)).toEqual([[1, 2]]);
    expect(splitColumns([1, 2], 2.7)).toEqual([[1], [2]]);
    expect(splitColumns([], 3)).toEqual([[], [], []]);
  });
});