import { describe, expect, test } from "vitest";
import { skinish, subjectMask } from "../../src/look/segment";

/**
 * The cut-out, tested on a frame whose answer we already know: a "person" on a plain wall, plus a
 * small dark smudge in a corner that must not be mistaken for one.
 */

function frameWithSubject(): { data: Uint8ClampedArray; width: number; height: number; centre: [number, number] } {
  const width = 120;
  const height = 90;
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const p = (y * width + x) * 4;
      const wall = 176 + ((x + y) % 9) - 4; // a wall with a little texture, not a flat fill
      data[p] = wall;
      data[p + 1] = wall + 6;
      data[p + 2] = wall + 16;
      data[p + 3] = 255;
    }
  }
  // The subject: a torso-ish blob, dark red, centred.
  const centre: [number, number] = [Math.round(width * 0.5), Math.round(height * 0.55)];
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const dx = (x - centre[0]) / 22;
      const dy = (y - centre[1]) / 30;
      if (dx * dx + dy * dy <= 1) {
        const p = (y * width + x) * 4;
        data[p] = 96;
        data[p + 1] = 34;
        data[p + 2] = 40;
      }
    }
  }
  // A small dark smudge in the corner — a picture frame on the wall, not a person.
  for (let y = 4; y < 12; y += 1) {
    for (let x = 4; x < 12; x += 1) {
      const p = (y * width + x) * 4;
      data[p] = 40;
      data[p + 1] = 30;
      data[p + 2] = 44;
    }
  }
  return { data, width, height, centre };
}

describe("finding the person", () => {
  test("the subject is kept, the wall is not", () => {
    const { data, width, height, centre } = frameWithSubject();
    const subject = subjectMask(data, width, height);

    expect(subject.mask[centre[1] * width + centre[0]]).toBeGreaterThan(200); // the person survives
    expect(subject.mask[0]).toBe(0); // the top-left corner of the wall is background
    expect(subject.mask[(height - 1) * width]).toBe(0); // and the bottom-left
    expect(subject.share).toBeGreaterThan(0.05);
    expect(subject.share).toBeLessThan(0.6);
  });

  test("a smudge on the wall is not a second person", () => {
    const { data, width, height } = frameWithSubject();
    const subject = subjectMask(data, width, height);
    // The largest region wins, so the corner smudge never makes it into the mask.
    expect(subject.mask[8 * width + 8]).toBe(0);
    expect(subject.box.x).toBeGreaterThan(20);
  });

  test("the box lands on the subject", () => {
    const { data, width, height, centre } = frameWithSubject();
    const { box } = subjectMask(data, width, height);
    expect(box.x).toBeLessThan(centre[0]);
    expect(box.x + box.width).toBeGreaterThan(centre[0]);
    expect(box.y).toBeLessThan(centre[1]);
    expect(box.height).toBeGreaterThan(20);
  });

  test("a face box is authoritative, whatever the growing decided", () => {
    const { data, width, height } = frameWithSubject();
    const keep: [number, number, number, number] = [90, 10, 20, 20];
    const subject = subjectMask(data, width, height, { keep });
    // (95, 15) is plain wall, and the growing called it background — the detector outranks it.
    expect(subject.mask[15 * width + 95]).toBeGreaterThan(200);
  });

  test("the same frame always cuts the same way", () => {
    const { data, width, height } = frameWithSubject();
    const first = subjectMask(data, width, height);
    const second = subjectMask(data, width, height);
    expect(Array.from(second.mask)).toEqual(Array.from(first.mask));
    expect(second.box).toEqual(first.box);
  });

  test("skin is recognised as skin, and the wall is not", () => {
    for (const [r, g, b] of [
      [222, 176, 148],
      [186, 138, 108],
      [128, 84, 66],
    ]) {
      expect(skinish(r, g, b), `skin ${r},${g},${b}`).toBe(true);
    }
    expect(skinish(176, 182, 192)).toBe(false); // the wall
    expect(skinish(96, 34, 40)).toBe(false); // the shirt
  });
});