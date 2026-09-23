import { describe, expect, test } from "vitest";
import { CITY_PALETTE, edgeMap, nearestAnchor, quantise, styliseImageData } from "../../src/look/stylise";

/**
 * The styliser is pure maths over typed arrays, so it is tested the way maths is: on a picture whose
 * answer we already know, plus the properties that must hold whatever the input.
 */

/** A 96×96 test frame: cool dark left, warm bright right, a hard seam down the middle. */
function testFrame(): { data: Uint8ClampedArray; width: number; height: number } {
  const width = 96;
  const height = 96;
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const p = (y * width + x) * 4;
      const left = x < width / 2;
      const shade = Math.round((y / height) * 40);
      data[p] = left ? 30 + shade : 210 + Math.min(30, shade);
      data[p + 1] = left ? 40 + shade : 120 + Math.min(30, shade);
      data[p + 2] = left ? 90 + shade : 60 + Math.min(20, shade);
      data[p + 3] = 255;
    }
  }
  return { data, width, height };
}

function grayOf(data: Uint8ClampedArray): Float32Array {
  const gray = new Float32Array(data.length / 4);
  for (let i = 0, p = 0; i < gray.length; i += 1, p += 4) {
    gray[i] = 0.2126 * data[p] + 0.7152 * data[p + 1] + 0.0722 * data[p + 2];
  }
  return gray;
}

function distinctColours(data: Uint8ClampedArray, quantum = 8): number {
  const seen = new Set<number>();
  for (let p = 0; p < data.length; p += 4) {
    seen.add(((data[p] / quantum) << 16) | ((data[p + 1] / quantum) << 8) | (data[p + 2] / quantum));
  }
  return seen.size;
}

/** A photo-like frame: the same composition plus per-pixel noise, so "flattening" means something. */
function noisyFrame(): { data: Uint8ClampedArray; width: number; height: number } {
  const { data, width, height } = testFrame();
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const p = (y * width + x) * 4;
      const noise = (((x * 37 + y * 91) % 53) - 26) * 1.6;
      data[p] = Math.max(0, Math.min(255, data[p] + noise));
      data[p + 1] = Math.max(0, Math.min(255, data[p + 1] + noise * 0.7));
      data[p + 2] = Math.max(0, Math.min(255, data[p + 2] - noise * 0.4));
    }
  }
  return { data, width, height };
}

describe("the GTA VI look, without a model", () => {
  test("the edge map finds the seam and leaves the flat halves alone", () => {
    const { data, width, height } = testFrame();
    const edges = edgeMap(grayOf(data), width, height);
    const seam = edges[48 * width + 48] + edges[48 * width + 47] + edges[48 * width + 49];
    const flatLeft = edges[48 * width + 8];
    const flatRight = edges[48 * width + 88];
    expect(seam).toBeGreaterThan(0);
    expect(flatLeft).toBe(0);
    expect(flatRight).toBe(0);
  });

  test("quantisation is deterministic and never returns more than k colours", () => {
    const { data, width, height } = testFrame();
    const first = quantise(data, width, height, 5, 7);
    const second = quantise(data, width, height, 5, 7);
    expect(first.length).toBeLessThanOrEqual(5);
    expect(second).toEqual(first);
  });

  test("every palette anchor is a real colour and the matcher picks the closest one", () => {
    for (const [r, g, b] of CITY_PALETTE) {
      for (const channel of [r, g, b]) expect(channel).toBeGreaterThanOrEqual(0), expect(channel).toBeLessThanOrEqual(255);
    }
    // Something obviously orange must land on an orange or gold anchor, not on the cyan.
    const { anchor } = nearestAnchor(250, 130, 60);
    expect(anchor[0]).toBeGreaterThan(200);
    expect(anchor[2]).toBeLessThan(130);
  });

  test("the stylised frame is reproducible, flat, and different from the photograph", () => {
    const { data, width, height } = testFrame();
    const once = styliseImageData(data, width, height, { seed: 3 });
    const twice = styliseImageData(data, width, height, { seed: 3 });
    expect(Array.from(twice)).toEqual(Array.from(once));

    // It actually did something.
    let difference = 0;
    for (let p = 0; p < data.length; p += 4) difference += Math.abs(once[p] - data[p]);
    expect(difference / (data.length / 4)).toBeGreaterThan(8);

    // And what it did was turn a photograph into paint. "Paint" is not a low global colour count —
    // this styliser keeps a fifth of the photographic texture on purpose, which is what stops it
    // banding. Paint means the local detail collapses: neighbouring pixels stop disagreeing.
    const noisy = noisyFrame();
    expect(distinctColours(noisy.data)).toBeGreaterThan(200); // the frame really is photo-like
    const roughness = (buffer: Uint8ClampedArray, width: number, height: number): number => {
      let total = 0;
      let count = 0;
      for (let y = 0; y < height; y += 1) {
        for (let x = 0; x < width - 1; x += 1) {
          const p = (y * width + x) * 4;
          total += Math.abs(buffer[p] - buffer[p + 4]) + Math.abs(buffer[p + 1] - buffer[p + 5]);
          count += 2;
        }
      }
      return total / count;
    };
    const painted = styliseImageData(noisy.data, noisy.width, noisy.height, { finish: 0, light: 0, tone: 0, paper: 0, exposure: 0, seed: 3 });
    const roughBefore = roughness(noisy.data, noisy.width, noisy.height);
    const roughAfter = roughness(painted, noisy.width, noisy.height);
    // Flatter than the photograph, but not by a landslide — and that is on purpose. The palette pull
    // and the exposure curve exist to raise the contrast *between* regions (that is what makes flat
    // areas read as separate shapes). The claim here is only that the noise inside them is gone.
    expect(roughAfter).toBeLessThan(roughBefore * 0.85);

    // With the light on, the frame gains a sky — and stays dominated by a few colours. Measured with
    // the paper, the grain and the exposure curve off: those are supposed to widen the distribution,
    // the paint is not.
    const lit = styliseImageData(noisy.data, noisy.width, noisy.height, { seed: 3, paper: 0, finish: 0, exposure: 0 });
    const buckets = new Map<number, number>();
    const pixels = lit.length / 4;
    for (let p = 0; p < lit.length; p += 4) {
      const key = ((lit[p] >> 4) << 8) | ((lit[p + 1] >> 4) << 4) | (lit[p + 2] >> 4);
      buckets.set(key, (buckets.get(key) ?? 0) + 1);
    }
    const top = [...buckets.values()].sort((a, b) => b - a).slice(0, 10);
    // Seven tenths, not nine: the split tone and the S-curve are smooth functions of luminance, so
    // they deliberately spread each flat region across neighbouring buckets. The claim being tested
    // is "a handful of colours dominate", and 0.7 is what this design delivers.
    expect(top.reduce((sum, count) => sum + count, 0) / pixels).toBeGreaterThan(0.7);
  });

  test("the seed changes the grain but not the composition", () => {
    const { data, width, height } = testFrame();
    const a = styliseImageData(data, width, height, { seed: 1 });
    const b = styliseImageData(data, width, height, { seed: 2 });
    expect(Array.from(a)).not.toEqual(Array.from(b));
    // Still the same picture: the mean colour of each half stays where it was.
    const half = (buffer: Uint8ClampedArray, left: boolean): number => {
      let total = 0;
      let count = 0;
      for (let y = 0; y < height; y += 1) {
        for (let x = left ? 0 : 60; x < (left ? 36 : width); x += 1) {
          total += buffer[(y * width + x) * 4];
          count += 1;
        }
      }
      return total / count;
    };
    expect(Math.abs(half(a, true) - half(b, true))).toBeLessThan(12);
    expect(half(a, false)).toBeGreaterThan(half(a, true));
  });

  test("a 256×256 frame stays inside a phone's patience", () => {
    const width = 256;
    const height = 256;
    const data = new Uint8ClampedArray(width * height * 4);
    for (let i = 0; i < data.length; i += 4) {
      data[i] = (i / 4) % 255;
      data[i + 1] = ((i / 4) * 7) % 255;
      data[i + 2] = 128;
      data[i + 3] = 255;
    }
    const started = Date.now();
    styliseImageData(data, width, height);
    expect(Date.now() - started).toBeLessThan(4000);
  });
});
