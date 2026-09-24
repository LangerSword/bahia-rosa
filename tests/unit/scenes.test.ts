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