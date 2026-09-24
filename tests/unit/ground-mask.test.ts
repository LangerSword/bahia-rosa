import { describe, expect, it } from "vitest";
import { groundPixelToMask } from "../../src/look/portrait";

/**
 * Mapping the mask onto the "as it is" ground.
 *
 * The ground is the visitor's photograph drawn with a *cover* fit — scaled up until it fills a 16:9 frame,
 * which crops it — and the mask arrives in the photograph's own coordinates. The first version of this mapped
 * one to the other as if no cropping had happened, so the room was cleared somewhere near the person instead
 * of on them, and a ghost of them stayed in the background. That is what a wrong mapping looks like: not a
 * crash, a ghost.
 */
describe("the mask on a cropped ground", () => {
  const maskWidth = 100;
  const maskHeight = 75;

  it("is the identity when the ground is not cropped", () => {
    expect(groundPixelToMask(10, 20, 1, 0, 0, maskWidth, maskHeight)).toBe(20 * maskWidth + 10);
  });

  it("follows the cover transform: a ground pixel reads the photograph under it", () => {
    // A 4:3 photograph covered into a 16:9 ground: cover = 1.5 over a 100px mask, so the photograph spans
    // ground x ∈ [-25, 125] and the crop takes 25px off each side. Ground 25 is the photograph's pixel 33;
    // ground 50 is the photograph's pixel 50; the photograph's right edge (mask 100) lands past 125.
    const cover = 1.5;
    const coverX = -25;
    expect(groundPixelToMask(25, 0, cover, coverX, 0, maskWidth, maskHeight)).toBe(33);
    expect(groundPixelToMask(50, 0, cover, coverX, 0, maskWidth, maskHeight)).toBe(50);
    expect(groundPixelToMask(125, 0, cover, coverX, 0, maskWidth, maskHeight)).toBe(99);
  });

  it("clamps anything outside the photograph to its edge rather than wrapping", () => {
    const corner = groundPixelToMask(-500, -500, 1.5, -25, 0, maskWidth, maskHeight);
    expect(corner).toBe(0);
    const far = groundPixelToMask(5000, 5000, 1.5, -25, 0, maskWidth, maskHeight);
    expect(far).toBe(maskHeight * maskWidth - 1);
  });
});