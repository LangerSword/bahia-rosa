import { describe, expect, it } from "vitest";
import { GRADES, gradeFor, gradePixels, hasGrade } from "../../src/look/timeofday";

/**
 * The hour has to be visible.
 *
 * The complaint was exact: choosing "neon" or "night" left the place looking the same, because the look
 * only ever changed the paint on the person. Now it grades the scene too — so these tests assert the
 * things a person can actually see: night is darker and cooler, golden hour is warmer, neon pushes
 * magenta into the shadows and cyan into the highlights, and none of them are the same as each other.
 */

const mid = (): Uint8ClampedArray => {
  const pixels = new Uint8ClampedArray(4 * 64);
  for (let i = 0; i < pixels.length; i += 4) {
    pixels[i] = 128;
    pixels[i + 1] = 128;
    pixels[i + 2] = 128;
    pixels[i + 3] = 255;
  }
  return pixels;
};

const mean = (pixels: Uint8ClampedArray): [number, number, number] => {
  let r = 0;
  let g = 0;
  let b = 0;
  const count = pixels.length / 4;
  for (let i = 0; i < pixels.length; i += 4) {
    r += pixels[i];
    g += pixels[i + 1];
    b += pixels[i + 2];
  }
  return [r / count, g / count, b / count];
};

describe("gradePixels", () => {
  it("never touches the alpha channel — a grade is not a cut", () => {
    const source = mid();
    const graded = gradePixels(source, GRADES.night);
    for (let i = 3; i < graded.length; i += 4) expect(graded[i]).toBe(255);
  });

  it("is deterministic: the same photo at the same hour prints the same frame", () => {
    const a = gradePixels(mid(), GRADES.neon);
    const b = gradePixels(mid(), GRADES.neon);
    expect(Array.from(a)).toEqual(Array.from(b));
  });

  it("makes night darker and cooler", () => {
    const [r, g, b] = mean(gradePixels(mid(), GRADES.night));
    expect(r).toBeLessThan(128);
    expect(b).toBeGreaterThan(r); // blue over red: the sky after dark
    expect(b).toBeGreaterThan(g);
  });

  it("makes golden hour warmer, and warmer than dusk", () => {
    const golden = mean(gradePixels(mid(), GRADES.golden));
    const dusk = mean(gradePixels(mid(), GRADES.dusk));
    expect(golden[0]).toBeGreaterThan(golden[2] + 20); // red well clear of blue
    expect(golden[0]).toBeGreaterThan(dusk[0]);
  });

  it("puts magenta in the shadows and cyan in the highlights for neon", () => {
    const dark = new Uint8ClampedArray(4 * 32);
    const bright = new Uint8ClampedArray(4 * 32);
    for (let i = 0; i < dark.length; i += 4) {
      dark[i] = 30;
      dark[i + 1] = 30;
      dark[i + 2] = 30;
      dark[i + 3] = 255;
      // Mid-bright rather than near-white: at 220 the blue channel clamps and the measurement turns
      // into a test of the clamp instead of the tint.
      bright[i] = 180;
      bright[i + 1] = 180;
      bright[i + 2] = 180;
      bright[i + 3] = 255;
    }

    const [dr, dg, db] = mean(gradePixels(dark, GRADES.neon));
    const [br, bg, bb] = mean(gradePixels(bright, GRADES.neon));

    expect(dr).toBeGreaterThan(dg); // shadow leans magenta (red and blue over green)
    expect(db).toBeGreaterThan(dg);
    // Cyan in the highlights means blue over red, by a distance. Green over red is not the claim: the
    // green gain is slightly under red's, so that pair sits within a couple of units of each other by
    // design, and asserting on it would be testing rounding.
    expect(bb).toBeGreaterThan(br + 30);
    expect(bb).toBeGreaterThan(bg);
  });

  it("gives every look a different result, so the choice means something", () => {
    const renders = Object.keys(GRADES).map((id) => mean(gradePixels(mid(), GRADES[id])).join(","));
    expect(new Set(renders).size).toBe(renders.length);
  });
});

describe("gradeFor", () => {
  it("falls back to dusk for a look it does not know, rather than doing nothing", () => {
    expect(gradeFor("something-else")).toBe(GRADES.dusk);
    expect(hasGrade("something-else")).toBe(false);
    expect(hasGrade("neon")).toBe(true);
  });
});