import { describe, expect, it } from "vitest";
import { cutAt, layerGeometry } from "../../src/world/compose";

/**
 * The crop's arithmetic — the mapping between where a cut line is dragged and how much is taken off.
 *
 * Three things make this worth its own test rather than a click in a browser:
 *
 *   1. the mapping is measured against the **uncropped** box, so the line does not chase the pointer as the
 *      crop it is making changes the size of what is drawn;
 *   2. the four edges are two pairs of mirror images — the top line measures down from the head, the bottom
 *      up from the foot, the left across from the left — and getting one backwards is the kind of bug that
 *      feels like the interface being broken rather than like arithmetic;
 *   3. the cuts become a **source rect** in `layerGeometry`, and two cuts of the maximum on one axis would
 *      leave it with no width or no height, which is a crash inside the painter rather than a crop.
 */

const BOX = { x: 100, y: 100, w: 300, h: 400 };

describe("where a cut line lands", () => {
  it("reads the top line as the fraction taken off the head, and the left as the fraction off the left", () => {
    expect(cutAt(BOX.y, BOX, "top")).toBe(0); // the line at the top of the box: nothing cut
    expect(cutAt(BOX.y + BOX.h / 2, BOX, "top")).toBeCloseTo(0.5, 5); // halfway down: half cut away
    expect(cutAt(BOX.y + BOX.h, BOX, "top")).toBeCloseTo(0.6, 5); // clamped at the ceiling

    expect(cutAt(BOX.x, BOX, "left")).toBe(0);
    expect(cutAt(BOX.x + BOX.w / 2, BOX, "left")).toBeCloseTo(0.5, 5);
    expect(cutAt(BOX.x + BOX.w, BOX, "left")).toBeCloseTo(0.6, 5);
  });

  it("reads the bottom and the right as the fractions taken off the foot and the right edge", () => {
    expect(cutAt(BOX.y + BOX.h, BOX, "bottom")).toBe(0); // at the foot: nothing cut
    expect(cutAt(BOX.y + BOX.h / 2, BOX, "bottom")).toBeCloseTo(0.5, 5);
    expect(cutAt(BOX.y, BOX, "bottom")).toBeCloseTo(0.6, 5); // at the head: clamped

    expect(cutAt(BOX.x + BOX.w, BOX, "right")).toBe(0);
    expect(cutAt(BOX.x + BOX.w / 2, BOX, "right")).toBeCloseTo(0.5, 5);
    expect(cutAt(BOX.x, BOX, "right")).toBeCloseTo(0.6, 5);
  });

  it("never lets a cut take more than the ceiling, and never a negative", () => {
    // Dragged well past either end — a visitor's pointer leaves the box in every direction all the time.
    expect(cutAt(BOX.y - 500, BOX, "top")).toBe(0);
    expect(cutAt(BOX.y + 5000, BOX, "bottom")).toBe(0);
    expect(cutAt(BOX.x - 500, BOX, "left")).toBe(0);
    expect(cutAt(BOX.x + 5000, BOX, "right")).toBe(0);
    expect(cutAt(BOX.y + 5000, BOX, "top")).toBe(0.6);
    expect(cutAt(BOX.y - 5000, BOX, "bottom")).toBe(0.6);
    expect(cutAt(BOX.x + 5000, BOX, "left")).toBe(0.6);
    expect(cutAt(BOX.x - 5000, BOX, "right")).toBe(0.6);
  });

  it("is a no-op on a box with no extent, rather than a division by zero", () => {
    expect(cutAt(123, { x: 10, y: 10, w: 0, h: 0 }, "top")).toBe(0);
    expect(cutAt(123, { x: 10, y: 10, w: 0, h: 0 }, "left")).toBe(0);
  });

  it("does not move when the crop it is making changes: the box it is given has no cuts on it", () => {
    // The same pointer, the same box, called twice — the second call is what a drag frame looks like after
    // the first has already been applied, and it has to agree.
    const first = cutAt(BOX.x + 120, BOX, "left");
    const second = cutAt(BOX.x + 120, BOX, "left");
    expect(second).toBe(first);
    expect(first).toBeCloseTo(0.4, 5);
  });
});

describe("the cuts become a source rect", () => {
  const IMAGE = { width: 1000, height: 500 };
  const RECT = { x: 0, y: 0, w: 1440, h: 810 };

  it("takes the left and right cuts off the width, keeping the middle", () => {
    const { source } = layerGeometry(IMAGE, RECT, {
      dx: 0,
      dy: 0,
      scale: 1,
      cropTop: 0,
      cropBottom: 0,
      cropLeft: 0.2,
      cropRight: 0.1,
      overflow: false,
    });
    expect(source.x).toBe(200); // a fifth off the left
    expect(source.w).toBe(700); // and a tenth off the right
  });

  it("survives the two maximum cuts on one axis — the case that would be a crash, not a crop", () => {
    const { source } = layerGeometry(IMAGE, RECT, {
      dx: 0,
      dy: 0,
      scale: 1,
      cropTop: 0.6,
      cropBottom: 0.6,
      cropLeft: 0.6,
      cropRight: 0.6,
      overflow: false,
    });
    expect(source.w).toBeGreaterThanOrEqual(1);
    expect(source.h).toBeGreaterThanOrEqual(1);
  });

  it("treats a layer saved before the left and right cuts existed as having none", () => {
    const { source } = layerGeometry(IMAGE, RECT, {
      dx: 0,
      dy: 0,
      scale: 1,
      cropTop: 0.1,
      cropBottom: 0,
      overflow: false,
    } as never);
    expect(source.x).toBe(0);
    expect(source.w).toBe(1000);
  });
});