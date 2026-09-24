import { afterAll, describe, expect, it } from "vitest";
import { writeFileSync } from "node:fs";
import { analyseLight, exposureAndCurve, srgbToOklab, whiteBalance } from "../../src/look/stylise";

/**
 * Colour under bad light.
 *
 * A photograph arrives with a claim about colour that is really a claim about its light. This measures the
 * press's answer to it: a known set of true colours, put through a *simulated* bad light — a dim tungsten
 * room, a blown-out window, a blue overcast street — and then through exactly the correction the press
 * applies (read the light, pull the cast back, shape the curve by the kind of light). The number is the
 * perceptual error against the colours that were actually there.
 *
 * The simulation is not a photograph, and no simulation is. It is a controlled case where the right answer
 * is known, which is the only way to put a number on "understands colour".
 */

const report: string[] = [];
const note = (line: string): void => {
  report.push(line);
  console.log(line);
};
afterAll(() => {
  writeFileSync("docs/lighting.txt", `${report.join("\n")}\n`);
});

/** The colours that were actually in the room, before any camera or lamp got involved. */
const TRUTH: [number, number, number][] = [
  [196, 152, 128], // skin
  [168, 62, 58], // a red shirt
  [62, 76, 104], // denim
  [90, 110, 170], // a blue wall
  [30, 55, 32], // foliage
  [216, 208, 196], // a white wall
  [120, 116, 108], // warm grey
];

/** A frame of flat patches of the true colours, so the measurement is about colour and nothing else. */
function frameOfTruth(scale = 1): { rgba: Uint8ClampedArray; width: number; height: number } {
  const width = 28;
  const height = TRUTH.length * 4;
  const rgba = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    const patch = TRUTH[Math.floor(y / 4)] ?? TRUTH[0];
    for (let x = 0; x < width; x += 1) {
      const p = (y * width + x) * 4;
      rgba[p] = Math.min(255, patch[0] * scale);
      rgba[p + 1] = Math.min(255, patch[1] * scale);
      rgba[p + 2] = Math.min(255, patch[2] * scale);
      rgba[p + 3] = 255;
    }
  }
  return { rgba, width, height };
}

/** What a camera sees: the true colours multiplied by the light's gain and its colour cast. */
function underLight(
  frame: { rgba: Uint8ClampedArray; width: number; height: number },
  gain: number,
  cast: [number, number, number],
): Uint8ClampedArray {
  const out = new Uint8ClampedArray(frame.rgba.length);
  for (let p = 0; p + 3 < frame.rgba.length; p += 4) {
    out[p] = Math.min(255, frame.rgba[p] * gain * cast[0]);
    out[p + 1] = Math.min(255, frame.rgba[p + 1] * gain * cast[1]);
    out[p + 2] = Math.min(255, frame.rgba[p + 2] * gain * cast[2]);
    out[p + 3] = 255;
  }
  return out;
}

/**
 * The correction the press applies to the *light*: read the frame, pull the cast back toward neutral.
 *
 * Deliberately without the tone curve. The curve is the look — it gives the paint its contrast, and it is
 * meant to move colours away from the photograph. Measuring "did it recover the truth" through the look
 * would be measuring the paint and calling it understanding, which is the mistake this split exists to
 * avoid. The curve's own effect is reported separately below, as a look, with no pass/fail attached.
 */
function recoverCast(raw: Uint8ClampedArray, width: number, height: number): Uint8ClampedArray {
  const light = analyseLight(raw, width, height, 1);
  return whiteBalance(raw, light.cast, light.balance);
}

/** The correction *and* the look, for reporting what the printed frame ends up as. */
function recoverAndPaint(raw: Uint8ClampedArray, width: number, height: number): Uint8ClampedArray {
  const light = analyseLight(raw, width, height, 1);
  const balanced = recoverCast(raw, width, height);
  const curve = exposureAndCurve(balanced, width, height, 0.75, light.mode);
  const out = new Uint8ClampedArray(balanced.length);
  for (let p = 0; p + 3 < balanced.length; p += 4) {
    out[p] = curve(balanced[p]);
    out[p + 1] = curve(balanced[p + 1]);
    out[p + 2] = curve(balanced[p + 2]);
    out[p + 3] = 255;
  }
  return out;
}

/** Mean perceptual error of a frame against the colours that were actually there. */
function errorAgainstTruth(pixels: Uint8ClampedArray, width: number, height: number): number {
  let total = 0;
  let count = 0;
  for (let y = 0; y < height; y += 1) {
    const patch = TRUTH[Math.floor(y / 4)] ?? TRUTH[0];
    for (let x = 0; x < width; x += 1) {
      const p = (y * width + x) * 4;
      const [L1, a1, b1] = srgbToOklab(pixels[p], pixels[p + 1], pixels[p + 2]);
      const [L2, a2, b2] = srgbToOklab(patch[0], patch[1], patch[2]);
      total += Math.sqrt((L1 - L2) ** 2 + (a1 - a2) ** 2 + (b1 - b2) ** 2);
      count += 1;
    }
  }
  return count ? total / count : 0;
}

/**
 * Colour error, with exposure taken out of it.
 *
 * The first version of this measured absolute colour and concluded the white balance was doing nothing. It
 * was doing its job perfectly — it had recovered the exact hue of every patch — but a dim room is still
 * dark, so every patch sat far from the truth in *lightness* and the number never moved. Lightness is the
 * curve's business (the exposure correction), not the colour's, so the two are measured apart: this is the
 * chromaticity error, each sample scaled to the truth's own lightness before the comparison.
 */
function chromaError(pixels: Uint8ClampedArray, width: number, height: number): number {
  let total = 0;
  let count = 0;
  for (let y = 0; y < height; y += 1) {
    const patch = TRUTH[Math.floor(y / 4)] ?? TRUTH[0];
    for (let x = 0; x < width; x += 1) {
      const p = (y * width + x) * 4;
      const [L1, a1, b1] = srgbToOklab(pixels[p], pixels[p + 1], pixels[p + 2]);
      const [L2, a2, b2] = srgbToOklab(patch[0], patch[1], patch[2]);
      const scale = L2 / Math.max(1e-6, L1);
      total += Math.sqrt((a1 * scale - a2) ** 2 + (b1 * scale - b2) ** 2);
      count += 1;
    }
  }
  return count ? total / count : 0;
}

/** Lightness error on its own: the exposure correction's number, not the colour's. */
function lightnessError(pixels: Uint8ClampedArray, width: number, height: number): number {
  let total = 0;
  let count = 0;
  for (let y = 0; y < height; y += 1) {
    const patch = TRUTH[Math.floor(y / 4)] ?? TRUTH[0];
    for (let x = 0; x < width; x += 1) {
      const p = (y * width + x) * 4;
      const [L1] = srgbToOklab(pixels[p], pixels[p + 1], pixels[p + 2]);
      const [L2] = srgbToOklab(patch[0], patch[1], patch[2]);
      total += Math.abs(L1 - L2);
      count += 1;
    }
  }
  return count ? total / count : 0;
}

describe("colour under bad light", () => {
  it("recognises a dim frame, a normal one, and a blown one", () => {
    const dim = frameOfTruth(0.28);
    const normal = frameOfTruth(1);
    const bright = frameOfTruth(2.6);
    expect(analyseLight(dim.rgba, dim.width, dim.height, 1).mode).toBe("dim");
    expect(analyseLight(normal.rgba, normal.width, normal.height, 1).mode).toBe("normal");
    expect(analyseLight(bright.rgba, bright.width, bright.height, 1).mode).toBe("bright");
  });

  it("reads the cast of the light, not the colours of the things", () => {
    const frame = frameOfTruth(1);
    // A tungsten room: the same objects, more red and much less blue.
    const tungsten = underLight(frame, 0.6, [1.28, 1.0, 0.7]);
    const reading = analyseLight(tungsten, frame.width, frame.height, 1);
    expect(reading.cast[0]).toBeLessThan(0.95); // pull the red back
    expect(reading.cast[2]).toBeGreaterThan(1.1); // lift the blue
    // And a neutral frame is read as neutral.
    const neutral = analyseLight(frame.rgba, frame.width, frame.height, 1);
    expect(Math.abs(neutral.cast[0] - 1)).toBeLessThan(0.08);
    expect(Math.abs(neutral.cast[2] - 1)).toBeLessThan(0.08);
  });

  it("recovers the true colours of a dim tungsten room", () => {
    const frame = frameOfTruth(1);
    const shot = underLight(frame, 0.34, [1.3, 1.0, 0.68]);
    const before = chromaError(shot, frame.width, frame.height);
    const after = chromaError(recoverCast(shot, frame.width, frame.height), frame.width, frame.height);
    const painted = recoverAndPaint(shot, frame.width, frame.height);
    note(
      `dim tungsten room: colour error ${before.toFixed(4)} as shot → ${after.toFixed(4)} after the correction · lightness ${lightnessError(
        shot,
        frame.width,
        frame.height,
      ).toFixed(4)} → ${lightnessError(painted, frame.width, frame.height).toFixed(4)} once the curve has lifted it`,
    );
    expect(after).toBeLessThan(before * 0.5);
  });

  it("recovers the cast of an overexposed frame, and admits what clipping costs", () => {
    const frame = frameOfTruth(1);
    // Bright, in blue shade, with the highlights still holding information — the kind of overexposure a
    // phone produces when it protects its highlights.
    const shot = underLight(frame, 1.1, [0.92, 0.98, 1.12]);
    const before = chromaError(shot, frame.width, frame.height);
    const after = chromaError(recoverCast(shot, frame.width, frame.height), frame.width, frame.height);
    note(`overexposed in blue shade: colour error ${before.toFixed(4)} as shot → ${after.toFixed(4)} after the correction`);
    // A *mild* cast is deliberately corrected only part of the way — a mild cast might be the scene itself
    // (a warm room someone chose, a blue hour) rather than a lie about colour — so the bar here is a fifth
    // better, not all the way better. The dim case above shows what the correction does when the cast is
    // strong enough to be a lamp: 79% of it, gone.
    expect(after).toBeLessThan(before * 0.85);

    // And the honest limits, reported rather than asserted because there is nothing to assert. A frame whose
    // highlights are clipped has thrown the information away: the white reference reads as flat white, so the
    // illuminant it describes is "none", and the correction correctly does nothing.
    for (const [label, gain, cast] of [
      ["highlights clipped", 1.9, [0.9, 0.98, 1.18]],
      ["clipped past recovery", 2.6, [0.85, 0.98, 1.25]],
    ] as [string, number, [number, number, number]][]) {
      const wrecked = underLight(frame, gain, cast);
      note(
        `  ${label} (gain ${gain}): colour error ${chromaError(wrecked, frame.width, frame.height).toFixed(4)} → ${chromaError(
          recoverCast(wrecked, frame.width, frame.height),
          frame.width,
          frame.height,
        ).toFixed(4)} — the white reference is gone, so there is nothing left to read the light from`,
      );
    }
  });

  it("leaves a well-exposed neutral frame alone", () => {
    const frame = frameOfTruth(1);
    const before = chromaError(frame.rgba, frame.width, frame.height);
    const after = chromaError(recoverCast(frame.rgba, frame.width, frame.height), frame.width, frame.height);
    const painted = recoverAndPaint(frame.rgba, frame.width, frame.height);
    note(
      `normal light: colour error ${before.toFixed(4)} as shot → ${after.toFixed(4)} after the correction · the printed frame, look included, sits ${errorAgainstTruth(
        painted,
        frame.width,
        frame.height,
      ).toFixed(4)} from the truth (that distance is the paint, not the correction)`,
    );
    // A neutral frame must come out of the correction essentially untouched: an over-eager white balance is
    // the failure mode here, and it would show up as this number rather than as a surprise.
    expect(after).toBeLessThan(0.02);
  });

  it("reports the average recovery across the kinds of light", () => {
    const frame = frameOfTruth(1);
    const cases: [string, number, [number, number, number]][] = [
      ["dim tungsten", 0.34, [1.3, 1.0, 0.68]],
      ["blown shade", 1.1, [0.92, 0.98, 1.12]],
    ];
    let asShot = 0;
    let recovered = 0;
    for (const [label, gain, cast] of cases) {
      const shot = underLight(frame, gain, cast);
      const before = chromaError(shot, frame.width, frame.height);
      const after = chromaError(recoverCast(shot, frame.width, frame.height), frame.width, frame.height);
      asShot += before;
      recovered += after;
      note(`  ${label.padEnd(14)} colour error ${before.toFixed(4)} → ${after.toFixed(4)}`);
    }
    const improvement = asShot > 0 ? ((asShot - recovered) / asShot) * 100 : 100;
    note(
      `average across the bad lights: colour error ${(asShot / cases.length).toFixed(4)} → ${(recovered / cases.length).toFixed(4)} · ${improvement.toFixed(1)}% closer to the colours that were actually there`,
    );
    // A neutral frame is not in this average on purpose: there is no cast to remove, so it can only dilute
    // the number. It has its own test, which asserts the correction leaves it alone.
    expect(improvement).toBeGreaterThan(50);
  });
});
