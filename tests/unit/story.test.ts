import { describe, expect, it } from "vitest";
import { STORY_LEAD, STORY_TAIL, storyAt, storyMoments } from "../../src/lib/story";

const images = { photograph: "/a.jpg", plate: "/b.jpg", city: "/c.jpg" };

describe("the story", () => {
  it("tells three moments in the order the work happens", () => {
    const moments = storyMoments(images);
    expect(moments.map((moment) => moment.id)).toEqual(["photograph", "plate", "city"]);
    expect(moments.map((moment) => moment.src)).toEqual(["/a.jpg", "/b.jpg", "/c.jpg"]);
  });

  it("every moment says what it is, for the eye and for a screen reader", () => {
    for (const moment of storyMoments(images)) {
      expect(moment.label.length, moment.id).toBeGreaterThan(2);
      expect(moment.note.length, moment.id).toBeGreaterThan(30);
      expect(moment.alt.length, moment.id).toBeGreaterThan(20);
    }
  });

  it("holds the first moment while the section arrives, and the last while it leaves", () => {
    expect(storyAt(0)).toEqual({ index: 0, slice: 0 });
    expect(storyAt(STORY_LEAD)).toEqual({ index: 0, slice: 0 });
    expect(storyAt(0.05)).toEqual({ index: 0, slice: 0 });
    expect(storyAt(STORY_TAIL).index).toBe(2);
    expect(storyAt(1)).toEqual({ index: 2, slice: 1 });
  });

  it("walks the middle of the story through the middle moment", () => {
    const middle = (STORY_LEAD + STORY_TAIL) / 2;
    const at = storyAt(middle);
    expect(at.index).toBe(1);
    expect(at.slice).toBeGreaterThan(0.2);
    expect(at.slice).toBeLessThan(0.8);
  });

  it("never walks backwards, and never leaves the three moments", () => {
    let last = -1;
    for (let step = 0; step <= 1.0001; step += 0.01) {
      const { index, slice } = storyAt(step);
      expect(index).toBeGreaterThanOrEqual(last);
      expect(index).toBeGreaterThanOrEqual(0);
      expect(index).toBeLessThanOrEqual(2);
      expect(slice).toBeGreaterThanOrEqual(0);
      expect(slice).toBeLessThanOrEqual(1);
      last = index;
    }
  });

  it("survives nonsense progress instead of throwing a NaN into the transform", () => {
    expect(storyAt(-5)).toEqual({ index: 0, slice: 0 });
    expect(storyAt(9)).toEqual({ index: 2, slice: 1 });
    expect(storyAt(Number.NaN).index).toBe(0);
  });
});