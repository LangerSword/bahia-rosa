import { describe, expect, it } from "vitest";
import { placeSubject } from "../../src/look/scenes";

/**
 * Where the person goes in the city.
 *
 * Three properties, and every one of them was a visible bug before it was a test:
 *
 *   1. the subject's aspect ratio survives the move (the painted crop used to be squashed into the
 *      subject's box, which stretched the person),
 *   2. the subject is bigger on the plate than it was in the photograph (the brief: scale the size up),
 *   3. the subject is connected to centre-bottom — centred horizontally, feet on the bottom edge.
 */

const out = { width: 1600, height: 900 };
const scene = { height: 0.85 };

describe("placeSubject", () => {
  it("keeps the crop's aspect ratio exactly", () => {
    const subject = { x: 200, y: 100, width: 300, height: 600 };
    const crop = { x: 150, y: 50, width: 400, height: 700 };

    const placed = placeSubject(subject, crop, scene, out);

    const cropAspect = crop.width / crop.height;
    const placedAspect = placed.width / placed.height;
    expect(placedAspect).toBeCloseTo(cropAspect, 6);
  });

  it("scales the subject to the scene's figure height", () => {
    const subject = { x: 0, y: 0, width: 200, height: 400 };
    const crop = { x: 0, y: 0, width: 200, height: 400 };

    const placed = placeSubject(subject, crop, scene, out);

    // 85% of 900 = 765 tall, and the width follows the same factor.
    expect(placed.height).toBeCloseTo(765, 6);
    expect(placed.width).toBeCloseTo((200 / 400) * 765, 6);
  });

  it("puts the subject's feet on the bottom edge", () => {
    // The subject sits 90px above the crop's bottom; scaled, those 90px are the gap under their feet.
    const subject = { x: 40, y: 20, width: 200, height: 380 };
    const crop = { x: 0, y: 0, width: 300, height: 500 };

    const placed = placeSubject(subject, crop, scene, out);
    const scale = placed.height / crop.height;
    const feetInCrop = subject.y - crop.y + subject.height; // 400

    expect(placed.y + feetInCrop * scale).toBeCloseTo(out.height, 6);
  });

  it("centres the subject on the frame, wherever they stood in the photograph", () => {
    const crop = { x: 0, y: 0, width: 600, height: 800 };

    const left = placeSubject({ x: 10, y: 0, width: 200, height: 700 }, crop, scene, out);
    const right = placeSubject({ x: 380, y: 0, width: 200, height: 700 }, crop, scene, out);

    const centreOf = (placed: { x: number; height: number }, subject: { x: number; width: number }): number => {
      const scale = placed.height / crop.height;
      return placed.x + (subject.x + subject.width / 2) * scale;
    };

    expect(centreOf(left, { x: 10, width: 200 })).toBeCloseTo(out.width / 2, 6);
    expect(centreOf(right, { x: 380, width: 200 })).toBeCloseTo(out.width / 2, 6);
  });

  it("a wide group is never pushed off the sides", () => {
    // The case this rule exists for: five people across a landscape frame. Sizing by height alone would
    // make the crop far wider than the frame and cut the end people off, which makes "the whole group"
    // false exactly where it was promised.
    const subject = { x: 40, y: 20, width: 1520, height: 500 };
    const crop = { x: 0, y: 0, width: 1600, height: 620 };

    const placed = placeSubject(subject, crop, { height: 0.85 }, { width: 1280, height: 720 });

    // The subject fits inside the frame with the margin on both sides — the crop may spill, because the
    // crop is transparent where the mask did not cut, and a person is not.
    const scale = placed.height / crop.height;
    const subjectWidthOnFrame = subject.width * scale;
    expect(subjectWidthOnFrame).toBeLessThanOrEqual(1280 * 0.92 + 1);
    expect(placed.width / placed.height).toBeCloseTo(crop.width / crop.height, 6);
    // The group is still centred, and its feet — the bottom of the *subject*, not of the crop that
    // carries it — are still on the frame's bottom edge, the same rule every placement obeys.
    expect(placed.x + placed.width / 2).toBeCloseTo(640, 6);
    expect(placed.y + (subject.y - crop.y + subject.height) * scale).toBeCloseTo(720, 6);
  });

  it("a subject who sits at the crop's edge still lands inside the frame", () => {
    // The fault a real photograph found: the crop has margins of its own, so a subject near the crop's
    // edge fits the crop and still runs off the frame. Capping by the crop answered the wrong question.
    const crop = { x: 0, y: 0, width: 1000, height: 500 };
    const subject = { x: 0, y: 0, width: 1000, height: 400 }; // the mask spans the whole crop width

    const placed = placeSubject(subject, crop, { height: 0.85 }, { width: 1280, height: 720 });

    const scale = placed.height / crop.height;
    expect(subject.width * scale).toBeLessThanOrEqual(1280 * 0.92 + 1);
    expect(placed.x + placed.width / 2).toBeCloseTo(640, 6);
  });

  it("a tall crop is still sized by height, where height is what fits", () => {
    // The width cap must not shrink a portrait that already fits: only the binding constraint applies.
    const subject = { x: 100, y: 100, width: 400, height: 1200 };
    const crop = { x: 80, y: 80, width: 440, height: 1240 };

    const placed = placeSubject(subject, crop, { height: 0.85 }, { width: 1280, height: 720 });

    const scale = placed.height / crop.height;
    expect(subject.height * scale).toBeCloseTo(720 * 0.85, 6);
  });

  it("a subject who was small in the photograph is still a presence on the plate", () => {
    // A full-body figure a tenth of the frame: 4000px tall photo, subject 400 tall.
    const subject = { x: 1800, y: 2000, width: 300, height: 400 };
    const crop = { x: 1750, y: 1960, width: 400, height: 500 };

    const placed = placeSubject(subject, crop, scene, out);

    // In the photograph they were 400/4000 = 10% of the height. On the plate the *subject* is 85% of
    // the frame — and the placed rect is the crop carrying them, which is taller still. Asserting on
    // the placed rect directly was the mistake: the crop is what gets placed.
    const scale = placed.height / crop.height;
    expect(subject.height * scale).toBeCloseTo(out.height * scene.height, 6);
    expect(placed.height).toBeCloseTo((crop.height / subject.height) * out.height * scene.height, 6);
    expect(scale).toBeGreaterThan(1.4); // drawn up, not down
  });
});