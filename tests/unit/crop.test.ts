import { describe, expect, it } from "vitest";
import { cutAt } from "../../src/world/compose";

/**
 * The crop's arithmetic — the mapping between where a cut line is dragged and how much is taken off.
 *
 * The two things that make this worth its own test rather than a click in a browser:
 *
 *   1. the mapping is measured against the **uncropped** box, so the line does not chase the pointer as the
 *      crop it is making changes the size of what is drawn;
 *   2. the two edges are mirror images — the top line measures down from the head, the bottom line measures
 *      up from the foot — and getting one of them backwards is the kind of bug that feels like the interface
 *      being broken rather than like arithmetic.
 */

const BOX = { y: 100, h: 400 };

describe("where a cut line lands", () => {
  it("reads the top line as the fraction taken off the head", () => {
    expect(cutAt(BOX.y, BOX, "top")).toBe(0); // the line at the top of the box: nothing cut
    expect(cutAt(BOX.y + BOX.h / 2, BOX, "top")).toBeCloseTo(0.5, 5); // halfway down: half cut away
    expect(cutAt(BOX.y + BOX.h, BOX, "top")).toBeCloseTo(0.6, 5); // the foot of the box: clamped at the ceiling
  });

  it("reads the bottom line as the fraction taken off the foot", () => {
    expect(cutAt(BOX.y + BOX.h, BOX, "bottom")).toBe(0); // at the foot: nothing cut
    expect(cutAt(BOX.y + BOX.h / 2, BOX, "bottom")).toBeCloseTo(0.5, 5);
    expect(cutAt(BOX.y, BOX, "bottom")).toBeCloseTo(0.6, 5); // at the head: clamped
  });

  it("never lets a cut take more than the ceiling, and never a negative", () => {
    // Dragged well past either end — a visitor's pointer leaves the box in both directions all the time.
    expect(cutAt(BOX.y - 500, BOX, "top")).toBe(0);
    expect(cutAt(BOX.y + 5000, BOX, "bottom")).toBe(0);
    expect(cutAt(BOX.y + 5000, BOX, "top")).toBe(0.6);
    expect(cutAt(BOX.y - 5000, BOX, "bottom")).toBe(0.6);
  });

  it("is a no-op on a box with no height, rather than a division by zero", () => {
    expect(cutAt(123, { y: 10, h: 0 }, "top")).toBe(0);
    expect(cutAt(123, { y: 10, h: 0 }, "bottom")).toBe(0);
  });

  it("does not move when the crop it is making changes: the box it is given has no cuts on it", () => {
    // The same pointer, the same box, called twice — the second call is what a drag frame looks like after
    // the first has already been applied, and it has to agree.
    const first = cutAt(BOX.y + 120, BOX, "top");
    const second = cutAt(BOX.y + 120, BOX, "top");
    expect(second).toBe(first);
    expect(first).toBeCloseTo(0.3, 5);
  });
});