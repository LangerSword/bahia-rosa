import { describe, expect, it } from "vitest";
import { needsResample } from "../../src/look/stylise";

/**
 * The press's sizes, and the question that cost a real photograph its frame.
 *
 * A 2592×1944 group photo failed with "offset is out of bounds": the crop needed no *upscale* (its short
 * edge was already past the paint edge), so the resample was skipped — but the ceiling had shrunk the
 * paint frame below the crop's own size, so the pixels went in at one size and were written into a
 * smaller frame. The rule asked whether the crop was being enlarged; what it needed to ask was whether
 * the sizes differed at all.
 */
describe("the paint size", () => {
  it("a large crop is still resampled to the paint size", () => {
    expect(needsResample({ width: 1280, height: 920 }, { width: 1100, height: 791 })).toBe(true);
  });

  it("a small crop is resampled up to the paint size", () => {
    expect(needsResample({ width: 400, height: 620 }, { width: 580, height: 900 })).toBe(true);
  });

  it("an identical size needs no resample", () => {
    expect(needsResample({ width: 1100, height: 791 }, { width: 1100, height: 791 })).toBe(false);
  });

  it("one differing edge is enough to need one", () => {
    expect(needsResample({ width: 1100, height: 791 }, { width: 1100, height: 790 })).toBe(true);
    expect(needsResample({ width: 1100, height: 791 }, { width: 1099, height: 791 })).toBe(true);
  });
});
