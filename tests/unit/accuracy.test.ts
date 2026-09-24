import { afterAll, describe, expect, it } from "vitest";
import { writeFileSync } from "node:fs";
import { refineEdges, softAlphaFromConfidence } from "../../src/look/bodysegment";
import { quantise, srgbToOklab } from "../../src/look/stylise";

/**
 * Accuracy, as numbers rather than adjectives.
 *
 * Two questions, measured separately because they fail separately:
 *
 *   · the cut — does the mask follow the edge of the person in the photograph, or the grid the model
 *     answered on? Measured as IoU against a known-truth mask, before and after the edge pass.
 *   · the colour — does the palette spend its colours where the eye can see the difference? Measured as
 *     the fraction of pixels whose palette colour is within a 5% perceptual error of their own colour, in
 *     Oklab, against the same quantiser in RGB.
 *
 * Every number is written to docs/accuracy.txt as well as the console: a test runner hides stdout for the
 * tests that pass, and a measurement nobody can read is not a measurement. The file is the record.
 */

const report: string[] = [];
const note = (line: string): void => {
  report.push(line);
  console.log(line);
};
afterAll(() => {
  writeFileSync("docs/accuracy.txt", `${report.join("\n")}\n`);
});

/** Intersection over union, at the usual 50% alpha. */
function iou(a: Uint8ClampedArray, b: Uint8ClampedArray, threshold = 128): number {
  let intersection = 0;
  let union = 0;
  for (let i = 0; i < Math.min(a.length, b.length); i += 1) {
    const inA = (a[i] ?? 0) > threshold;
    const inB = (b[i] ?? 0) > threshold;
    if (inA && inB) intersection += 1;
    if (inA || inB) union += 1;
  }
  return union ? intersection / union : 1;
}

/** A synthetic photograph: a warm subject with a hard edge, on a grainy wall with a soft gradient. */
function syntheticPhoto(width: number, height: number) {
  const rgba = new Uint8ClampedArray(width * height * 4);
  const truth = new Uint8ClampedArray(width * height);
  const box = { x: 70, y: 30, width: 60, height: 100 };
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = y * width + x;
      const p = i * 4;
      const inside = x >= box.x && x < box.x + box.width && y >= box.y && y < box.y + box.height;
      const wall = 60 + Math.round((x / width) * 30) + ((x * 7 + y * 13) % 5);
      rgba[p] = inside ? 205 : wall;
      rgba[p + 1] = inside ? 170 : wall + 2;
      rgba[p + 2] = inside ? 150 : wall + 6;
      rgba[p + 3] = 255;
      truth[i] = inside ? 255 : 0;
    }
  }
  return { rgba, truth, width, height };
}

/**
 * What a 256×256 model answer looks like once it is scaled to the frame: the right shape with the wrong
 * edge — shifted by a few pixels and blurred across the boundary, which is exactly the error the edge pass
 * exists to remove.
 */
function modelMask(truth: Uint8ClampedArray, width: number, height: number, shift = 3): Uint8ClampedArray {
  const moved = new Uint8ClampedArray(truth.length);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      moved[y * width + x] = truth[y * width + Math.min(width - 1, Math.max(0, x - shift))];
    }
  }
  const blurred = new Uint8ClampedArray(truth.length);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let sum = 0;
      let count = 0;
      for (let dy = -2; dy <= 2; dy += 1) {
        for (let dx = -2; dx <= 2; dx += 1) {
          const sx = Math.min(width - 1, Math.max(0, x + dx));
          const sy = Math.min(height - 1, Math.max(0, y + dy));
          sum += moved[sy * width + sx];
          count += 1;
        }
      }
      blurred[y * width + x] = Math.round(sum / count);
    }
  }
  return blurred;
}

/** A frame with plenty of colours in it, including the awkward pairs. */
function patchwork(width: number, height: number) {
  const rgba = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const p = (y * width + x) * 4;
      rgba[p] = 40 + ((x * 3) % 200);
      rgba[p + 1] = 60 + ((y * 5) % 180);
      rgba[p + 2] = 50 + (((x + y) * 7) % 190);
      rgba[p + 3] = 255;
    }
  }
  return { rgba, width, height };
}

/** Every pixel's palette colour, by nearest centroid — the assignment half of the colour breaker. */
function assign(
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
  centroids: [number, number, number][],
  space: "rgb" | "oklab",
): Uint8ClampedArray {
  const out = new Uint8ClampedArray(rgba.length);
  const lab = centroids.map(([r, g, b]) => srgbToOklab(r, g, b));
  for (let i = 0, p = 0; i < width * height; i += 1, p += 4) {
    let best = 0;
    let bestDistance = Infinity;
    if (space === "rgb") {
      for (let c = 0; c < centroids.length; c += 1) {
        const dr = rgba[p] - centroids[c][0];
        const dg = rgba[p + 1] - centroids[c][1];
        const db = rgba[p + 2] - centroids[c][2];
        const d = dr * dr + dg * dg + db * db;
        if (d < bestDistance) {
          bestDistance = d;
          best = c;
        }
      }
    } else {
      const [L, A, B] = srgbToOklab(rgba[p], rgba[p + 1], rgba[p + 2]);
      for (let c = 0; c < lab.length; c += 1) {
        const dL = L - lab[c][0];
        const dA = A - lab[c][1];
        const dB = B - lab[c][2];
        const d = dL * dL + dA * dA + dB * dB;
        if (d < bestDistance) {
          bestDistance = d;
          best = c;
        }
      }
    }
    out[p] = centroids[best][0];
    out[p + 1] = centroids[best][1];
    out[p + 2] = centroids[best][2];
    out[p + 3] = 255;
  }
  return out;
}

/** The quantiser this press used before Oklab: the same k-means, in RGB. Kept here to be beaten. */
function quantiseRGB(
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
  k: number,
): [number, number, number][] {
  const samples: [number, number, number][] = [];
  const step = Math.max(1, Math.floor(Math.sqrt((width * height) / 4096)));
  for (let y = 0; y < height; y += step) {
    for (let x = 0; x < width; x += step) {
      const q = (y * width + x) * 4;
      samples.push([rgba[q], rgba[q + 1], rgba[q + 2]]);
    }
  }
  const centroids: [number, number, number][] = [];
  for (let i = 0; i < k; i += 1) {
    const pick = samples[Math.floor((i / k) * samples.length)] ?? samples[0];
    centroids.push([pick[0], pick[1], pick[2]]);
  }
  for (let iteration = 0; iteration < 8; iteration += 1) {
    const sums = centroids.map(() => [0, 0, 0, 0]);
    for (const [r, g, b] of samples) {
      let best = 0;
      let bestDistance = Infinity;
      for (let c = 0; c < centroids.length; c += 1) {
        const dr = r - centroids[c][0];
        const dg = g - centroids[c][1];
        const db = b - centroids[c][2];
        const d = dr * dr + dg * dg + db * db;
        if (d < bestDistance) {
          bestDistance = d;
          best = c;
        }
      }
      sums[best][0] += r;
      sums[best][1] += g;
      sums[best][2] += b;
      sums[best][3] += 1;
    }
    for (let c = 0; c < centroids.length; c += 1) {
      if (sums[c][3] === 0) continue;
      centroids[c] = [sums[c][0] / sums[c][3], sums[c][1] / sums[c][3], sums[c][2] / sums[c][3]];
    }
  }
  return centroids;
}

/** The fraction of pixels whose colour survived within a 5% perceptual error (ΔE ≤ 0.05 in Oklab). */
function withinFivePercent(
  source: Uint8ClampedArray,
  painted: Uint8ClampedArray,
  width: number,
  height: number,
): number {
  let within = 0;
  for (let i = 0, p = 0; i < width * height; i += 1, p += 4) {
    const [L1, a1, b1] = srgbToOklab(source[p], source[p + 1], source[p + 2]);
    const [L2, a2, b2] = srgbToOklab(painted[p], painted[p + 1], painted[p + 2]);
    const distance = Math.sqrt((L1 - L2) ** 2 + (a1 - a2) ** 2 + (b1 - b2) ** 2);
    if (distance <= 0.05) within += 1;
  }
  return within / (width * height);
}

/**
 * A realistic frame: many materials, each with its own gradient and grain — sky, foliage, skin, a shirt, a
 * wall, hair. A real photograph has twenty-odd perceptually distinct colours in it, which is what makes a
 * palette of eight a *look* and a palette of thirty an approximation of the truth. An earlier version of
 * this function had four flat materials and eight colours covered it perfectly, which measured nothing.
 */
function photograph(width: number, height: number) {
  const rgba = new Uint8ClampedArray(width * height * 4);
  const clamp = (value: number) => Math.max(0, Math.min(255, Math.round(value)));
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const p = (y * width + x) * 4;
      const u = x / width;
      const v = y / height;
      let r: number;
      let g: number;
      let b: number;
      if (v < 0.34) {
        // sky: a gradient from deep blue to pale warm, the widest thing in the frame
        r = 90 + v * 220;
        g = 110 + v * 200;
        b = 170 + v * 60;
      } else if (u < 0.22) {
        // foliage: dark greens, each leaf a slightly different one
        const leaf = ((x * 7 + y * 11) % 23) / 23;
        r = 30 + leaf * 45 + v * 20;
        g = 55 + leaf * 70 + v * 25;
        b = 32 + leaf * 30 + v * 15;
      } else if (u > 0.68 && v > 0.3) {
        // a wall in shade: warm greys
        r = 120 + ((x * 5) % 31);
        g = 116 + ((y * 3) % 27);
        b = 108 + (((x + y) * 2) % 25);
      } else if (v > 0.62) {
        // a red shirt with folds
        const fold = Math.sin(x / 9) * 12 + Math.sin(y / 13) * 8;
        r = 168 + fold;
        g = 62 + fold * 0.4;
        b = 58 + fold * 0.3;
      } else if (v > 0.42) {
        // skin, with its own shading
        r = 196 - v * 26 + ((x * 3) % 13);
        g = 152 - v * 30 + ((y * 5) % 11);
        b = 128 - v * 24 + (((x + y) * 3) % 9);
      } else {
        // denim
        r = 62 + ((x * 3) % 17);
        g = 76 + ((y * 5) % 15);
        b = 104 + (((x * 2 + y) * 3) % 19);
      }
      const grain = ((x * 13 + y * 7) % 11) - 5;
      rgba[p] = clamp(r + grain);
      rgba[p + 1] = clamp(g + grain);
      rgba[p + 2] = clamp(b + grain);
      rgba[p + 3] = 255;
    }
  }
  return { rgba, width, height };
}

/** The mean perceptual error over a frame, in Oklab — a more stable number than any threshold count. */
function meanDeltaE(source: Uint8ClampedArray, painted: Uint8ClampedArray, width: number, height: number): number {
  let total = 0;
  for (let i = 0, p = 0; i < width * height; i += 1, p += 4) {
    const [L1, a1, b1] = srgbToOklab(source[p], source[p + 1], source[p + 2]);
    const [L2, a2, b2] = srgbToOklab(painted[p], painted[p + 1], painted[p + 2]);
    total += Math.sqrt((L1 - L2) ** 2 + (a1 - a2) ** 2 + (b1 - b2) ** 2);
  }
  return total / (width * height);
}

describe("the accuracy of the press", () => {
  it("the edge pass moves the cut onto the photograph's own edge", () => {
    const { rgba, truth, width, height } = syntheticPhoto(200, 150);
    const before = modelMask(truth, width, height);
    const after = refineEdges(before, rgba, width, height);

    const scoreBefore = iou(before, truth);
    const scoreAfter = iou(after, truth);
    note(
      `cut accuracy: ${(scoreBefore * 100).toFixed(1)}% as the model answered · ${(scoreAfter * 100).toFixed(1)}% after the edge pass`,
    );

    expect(scoreAfter).toBeGreaterThan(scoreBefore);
    expect(scoreAfter).toBeGreaterThanOrEqual(0.95);
  });

  it("the soft mask keeps the ramp the model's probabilities describe", () => {
    // A boundary three pixels wide: 100% background, then 50%, then 100% person.
    const background = new Float32Array([1, 1, 0.5, 0.2, 0]);
    const alpha = softAlphaFromConfidence(background, 5, 1);
    expect(alpha[0]).toBe(0);
    expect(alpha[1]).toBe(0);
    expect(alpha[2]).toBeGreaterThan(0);
    expect(alpha[2]).toBeLessThan(255);
    expect(alpha[3]).toBe(255);
    expect(alpha[4]).toBe(255);
  });

  it("the colour breaker lands within 5% on 95% of a realistic frame", () => {
    const { rgba, width, height } = photograph(200, 150);
    const scores = [8, 12, 16, 24, 32, 48].map((colours) => {
      const painted = assign(rgba, width, height, quantise(rgba, width, height, colours), "oklab");
      return {
        colours,
        score: withinFivePercent(rgba, painted, width, height),
        error: meanDeltaE(rgba, painted, width, height),
      };
    });
    note(
      `colour fidelity on a photograph-like frame (within ΔE 0.05 / mean ΔE): ${scores
        .map(
          ({ colours, score, error }) =>
            `${colours}c ${(score * 100).toFixed(1)}% / ${error.toFixed(4)}`,
        )
        .join(" · ")}`,
    );

    const at = (colours: number) => scores.find((entry) => entry.colours === colours);
    const twentyFour = at(24);
    const thirtyTwo = at(32);
    if (twentyFour && thirtyTwo) {
      note(
        `fine finish check: 24 colours mean ΔE ${twentyFour.error.toFixed(4)} · 32 colours mean ΔE ${thirtyTwo.error.toFixed(4)}`,
      );
    }

    expect(at(32)?.score ?? 0).toBeGreaterThanOrEqual(0.95);
  });

  it("spends its palette better than RGB did, at the same palette size", () => {
    const { rgba, width, height } = photograph(200, 150);
    const inRgb = assign(rgba, width, height, quantiseRGB(rgba, width, height, 24), "rgb");
    const inOklab = assign(rgba, width, height, quantise(rgba, width, height, 24), "oklab");
    const scoreRgb = withinFivePercent(rgba, inRgb, width, height);
    const scoreOklab = withinFivePercent(rgba, inOklab, width, height);
    const errorRgb = meanDeltaE(rgba, inRgb, width, height);
    const errorOklab = meanDeltaE(rgba, inOklab, width, height);
    note(
      `24 colours, RGB vs Oklab: ${(scoreRgb * 100).toFixed(1)}% / ΔE ${errorRgb.toFixed(4)} vs ${(
        scoreOklab * 100
      ).toFixed(1)}% / ΔE ${errorOklab.toFixed(4)}`,
    );
    expect(scoreOklab).toBeGreaterThan(scoreRgb);
    expect(errorOklab).toBeLessThan(errorRgb);
  });

  it("spends its palette better than RGB did, on a frame no palette could cover", () => {
    // The stress case: a lattice of colours sweeping the whole gamut, which no palette can represent.
    const { rgba, width, height } = patchwork(160, 120);
    const inRgb = assign(rgba, width, height, quantiseRGB(rgba, width, height, 24), "rgb");
    const inOklab = assign(rgba, width, height, quantise(rgba, width, height, 24), "oklab");
    const scoreRgb = withinFivePercent(rgba, inRgb, width, height);
    const scoreOklab = withinFivePercent(rgba, inOklab, width, height);
    note(
      `gamut stress frame: ${(scoreRgb * 100).toFixed(1)}% in RGB · ${(scoreOklab * 100).toFixed(1)}% in Oklab`,
    );
    expect(scoreOklab).toBeGreaterThan(scoreRgb);
  });

  it("the fast look is reported at its own palette, not dressed up", () => {
    const { rgba, width, height } = photograph(200, 150);
    // Twelve colours, because that is what "fast" paints with now: eight was the flat poster look, and the
    // measurement (86.9% at eight, 97.2% at sixteen) said most of that colour was available for a tenth of a
    // second — so the finish took it, and this line reports what it actually ships.
    const fast = assign(rgba, width, height, quantise(rgba, width, height, 12), "oklab");
    const fastRgb = assign(rgba, width, height, quantiseRGB(rgba, width, height, 12), "rgb");
    const score = withinFivePercent(rgba, fast, width, height);
    note(
      `the fast look, 12 colours: ${(score * 100).toFixed(1)}% within ΔE 0.05 (mean ΔE ${meanDeltaE(
        rgba,
        fast,
        width,
        height,
      ).toFixed(4)}) · RGB ${(withinFivePercent(rgba, fastRgb, width, height) * 100).toFixed(
        1,
      )}% (mean ΔE ${meanDeltaE(rgba, fastRgb, width, height).toFixed(4)})`,
    );
    // No 95% bar here: twelve colours is still the poster look, just a gentler one. And no claim that Oklab
    // beats RGB at this size either — the measurement says the two are equivalent here, and a test asserting
    // otherwise would be asserting a preference rather than a result. The advantage shows up where the fine
    // finish works: from sixteen colours up, and on frames with real gamut in them.
    const errorOklab = meanDeltaE(rgba, fast, width, height);
    const errorRgb = meanDeltaE(rgba, fastRgb, width, height);
    // At twelve colours the perceptual space *does* earn its keep — 0.0190 against RGB's 0.0223, 15% lower mean
    // error. At eight the two measured as equivalent, which is why this line used to assert equality: the
    // palette changed, so the assertion follows the measurement rather than the other way round.
    expect(errorOklab).toBeLessThan(errorRgb * 0.95);
  });

  it("reports the average of the two accuracies the press is judged on", () => {
    const { rgba, truth, width, height } = syntheticPhoto(200, 150);
    const cut = iou(refineEdges(modelMask(truth, width, height), rgba, width, height), truth);

    const { rgba: frame, width: fw, height: fh } = photograph(200, 150);
    const colour = withinFivePercent(
      frame,
      assign(frame, fw, fh, quantise(frame, fw, fh, 32), "oklab"),
      fw,
      fh,
    );

    const average = (cut + colour) / 2;
    note(
      `average accuracy: cut ${(cut * 100).toFixed(1)}% · colour ${(colour * 100).toFixed(1)}% · average ${(
        average * 100
      ).toFixed(1)}%`,
    );
    expect(average).toBeGreaterThanOrEqual(0.95);
  });
});
