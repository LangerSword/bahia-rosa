import { describe, expect, it } from "vitest";
import { cleanMask, strictClasses } from "../../src/look/bodysegment";

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

  it("keeps a whole group, and the box spans all of them", () => {
    // The case that produced the failure: four people, each their own connected component. The old rule
    // ("largest component wins") kept whoever was biggest and dropped the friends, which then produced a
    // mask and a box that the compositor could not use.
    const width = 64;
    const height = 48;
    const map = blank(width, height);
    fill(map, width, 4, 12, 10, 36, CLOTHES);
    fill(map, width, 18, 14, 24, 38, HAIR);
    fill(map, width, 32, 11, 38, 35, CLOTHES);
    fill(map, width, 46, 15, 52, 39, HAIR);

    const { alpha, box, share } = cleanMask(map, width, height);

    // Everyone is in the mask — four people, not the tallest one.
    for (const x of [6, 20, 34, 48]) expect(alpha[25 * width + x], `column ${x} was dropped`).toBe(255);
    // And the box spans the group, so the crop that gets painted holds them all.
    expect(box.x).toBe(4);
    expect(box.x + box.width).toBe(53);
    expect(box.y).toBe(11);
    expect(box.y + box.height).toBe(40);
    // Four 7×25 figures in a 64×48 map: the share is the group's area, exactly — not "more than some
    // number", because the next person to read this should be able to check it with a calculator.
    expect(share).toBeCloseTo((4 * 7 * 25) / (64 * 48), 3);
  });

  it("still drops speckle standing next to a group", () => {
    const width = 64;
    const height = 48;
    const map = blank(width, height);
    fill(map, width, 4, 12, 10, 36, CLOTHES);
    fill(map, width, 18, 14, 24, 38, HAIR);
    fill(map, width, 2, 2, 3, 3, HAIR); // four pixels of "hair" on the wall

    const { alpha } = cleanMask(map, width, height);

    expect(alpha[2 * width + 2]).toBe(0);
    expect(alpha[25 * width + 6]).toBe(255);
  });

  it("keeps everybody it saw in `everyone`, even the person the plate declines to paint", () => {
    // This is the ghost, as a unit test. The cut keeps people above a share of the largest, so somebody
    // small and far back can be dropped from `alpha` — and if the ground of "as it is" is cleared with
    // `alpha`, that dropped person stays in the room behind, at full size, as a copy of themselves. The
    // ground needs everybody the model saw, which is what `everyone` is for.
    const width = 64;
    const height = 64;
    const map = blank(width, height);
    fill(map, width, 8, 8, 47, 55, CLOTHES); // the person at the lens: 40×48 = 1920 pixels
    fill(map, width, 55, 10, 61, 16, HAIR); // somebody at the back: 7×7 = 49 pixels

    const { alpha, everyone, subjects } = cleanMask(map, width, height);

    // The small figure is below a share of the largest (0.18 × 1920 = 346), so the painted mask drops them…
    expect(subjects).toBe(1);
    expect(alpha[13 * width + 58]).toBe(0);
    // …and `everyone` still has them, so the room can be cleared where they stood.
    expect(everyone[13 * width + 58]).toBe(255);
    // The speckle floor still applies to `everyone`: four pixels on a wall are not a person.
    const speckle = blank(width, height);
    fill(speckle, width, 8, 8, 47, 55, CLOTHES);
    fill(speckle, width, 2, 2, 3, 3, HAIR);
    expect(cleanMask(speckle, width, height).everyone[2 * width + 2]).toBe(0);
  });
});

describe("a mask that swallowed the frame — the illustration case", () => {
  /**
   * A poster is out of distribution for a model trained on photographs: "person" wins nearly everywhere, the
   * mask covers the frame, and the press refuses it — which used to mean the plate was painted flat, i.e. the
   * poster recoloured with its own artwork still in it. The confidences still separate the figure from the
   * flat ground, so the same information is asked a harder question.
   */
  it("is re-read from the confidences, so a figure is still found", () => {
    const width = 40;
    const height = 40;
    const soft = new Uint8ClampedArray(width * height).fill(140); // the poster's ground: person-ish, not certain
    for (let y = 8; y < 28; y += 1) {
      for (let x = 14; x < 26; x += 1) soft[y * width + x] = 250; // the figure: near-certain person
    }

    const classes = strictClasses(soft);
    expect(classes[0]).toBe(0); // the ground is not a person
    expect(classes[8 * width + 14]).toBe(1); // the figure is

    const { share, subjects } = cleanMask(classes, width, height);
    expect(subjects).toBe(1);
    // 12×20 of 40×40 — a share the press can use, where the winning class gave it the whole frame.
    expect(share).toBeGreaterThan(0.1);
    expect(share).toBeLessThan(0.2);
  });
});
