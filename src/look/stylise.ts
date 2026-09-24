/**
 * The look, in the browser, with no model.
 *
 * A photograph becomes a painted frame by classical image processing. The first version of this file
 * produced a grade with grain on it: quantising per pixel against the noisy original makes a mosaic,
 * and a gaussian blur makes mud. This is the second pass, and every stage earns its place:
 *
 *   1. bilateral filter     — kills texture, keeps edges (a gaussian cannot do both)
 *   2. Sobel + hysteresis   — the ink, thresholded from the frame's own histogram
 *   3. k-means, then REGIONS — pixels are labelled, then connected components are averaged, so the
 *                              result is flat patches with clean boundaries instead of speckle
 *   4. palette pull          — per region, toward the city's anchors, with a skin guard
 *   5. split tone            — violet in the shadows, gold in the light: the signature of the look
 *   6. ink, bloom, paper, grain, vignette, misregistration
 *
 * Deterministic (a fixed lattice seeds the clustering, noise is a hash of the pixel position, never
 * Math.random) and free of DOM APIs below `styliseImage`, so all of it is testable in node.
 */

/** The anchors every painted region is pulled toward. */
export const CITY_PALETTE: readonly [number, number, number][] = [
  [26, 14, 44], // deep violet — shadow
  [62, 30, 86], // dusk violet
  [128, 44, 96], // plum haze
  [226, 58, 104], // neon pink
  [255, 128, 58], // sunset orange
  [255, 202, 104], // gold
  [96, 220, 226], // cyan
  [22, 104, 118], // sea teal
];

export interface StyliseOptions {
  /** How many painted regions the frame is reduced to. */
  colours?: number;
  /** How hard each region is pulled toward CITY_PALETTE, 0..1. */
  palette?: number;
  /** Ink weight on the lines, 0..1. */
  ink?: number;
  /** Grain and vignette, 0..1. */
  finish?: number;
  /** The warm sky bloom and the low sun, 0..1. Zero leaves the palette exactly as painted. */
  light?: number;
  /** Violet shadows and gold highlights, 0..1. */
  tone?: number;
  /** Brush texture over the whole frame, 0..1. */
  paper?: number;
  /** Edge-preserving smoothing strength, 0..1. */
  smooth?: number;
  /** How hard to normalise exposure before painting, 0..1. 1 lifts a night photo, 0 leaves it dark. */
  exposure?: number;
  /** Changes the grain and the lattice jitter, so the same photo can be printed differently. */
  seed?: number;
}

const DEFAULTS: Required<StyliseOptions> = {
  colours: 9,
  palette: 0.5,
  ink: 0.55,
  finish: 0.55,
  light: 0.3,
  tone: 0.45,
  paper: 0.35,
  smooth: 0.55,
  exposure: 0.75,
  seed: 1,
};

/* ---------- small numeric helpers ---------- */

function clamp(value: number, low = 0, high = 255): number {
  return value < low ? low : value > high ? high : value;
}

/** Deterministic noise in [-1, 1] from a position and a seed — no Math.random anywhere. */
function hashNoise(x: number, y: number, seed: number): number {
  let h = (x * 374761393 + y * 668265263 + seed * 2246822519) >>> 0;
  h = (h ^ (h >>> 13)) >>> 0;
  h = Math.imul(h, 1274126177) >>> 0;
  return ((h ^ (h >>> 16)) / 4294967295) * 2 - 1;
}

/** Smooth value noise, the paper the paint sits on. */
export function valueNoise(x: number, y: number, cell: number, seed: number): number {
  const gx = x / cell;
  const gy = y / cell;
  const x0 = Math.floor(gx);
  const y0 = Math.floor(gy);
  const fx = gx - x0;
  const fy = gy - y0;
  const sx = fx * fx * (3 - 2 * fx);
  const sy = fy * fy * (3 - 2 * fy);
  const corner = (cx: number, cy: number): number => hashNoise(cx, cy, seed);
  const top = corner(x0, y0) * (1 - sx) + corner(x0 + 1, y0) * sx;
  const bottom = corner(x0, y0 + 1) * (1 - sx) + corner(x0 + 1, y0 + 1) * sx;
  return top * (1 - sy) + bottom * sy;
}

function toGray(rgba: Uint8ClampedArray, width: number, height: number): Float32Array {
  const gray = new Float32Array(width * height);
  for (let i = 0, p = 0; i < gray.length; i += 1, p += 4) {
    gray[i] = 0.2126 * rgba[p] + 0.7152 * rgba[p + 1] + 0.0722 * rgba[p + 2];
  }
  return gray;
}

/**
 * Exposure normalisation, then an S-curve.
 *
 * A photograph taken at night keeps its whole picture between 10 and 70; quantised and pulled toward
 * a daytime palette, that becomes mud. The percentiles are used rather than min/max so that one blown
 * highlight or one black corner cannot set the range.
 */
export function exposureAndCurve(
  source: Uint8ClampedArray,
  _width: number,
  _height: number,
  strength = 0.75,
): (value: number) => number {
  const histogram = new Uint32Array(256);
  for (let p = 0; p < source.length; p += 4) {
    histogram[Math.round(0.2126 * source[p] + 0.7152 * source[p + 1] + 0.0722 * source[p + 2])] += 1;
  }
  const pixels = source.length / 4;
  const quantile = (fraction: number): number => {
    const target = pixels * fraction;
    let seen = 0;
    for (let bin = 0; bin < 256; bin += 1) {
      seen += histogram[bin];
      if (seen >= target) return bin;
    }
    return 255;
  };
  const black = quantile(0.02);
  const white = quantile(0.99);
  const span = Math.max(24, white - black);
  const norm = 255 / span;

  return (value: number): number => {
    // strength 0 is an identity: the normalisation is blended in, not applied and then dimmed, so a
    // caller who asks for no exposure correction gets exactly none.
    const lifted =
      strength <= 0 ? value : clamp(value + ((value - black) * norm - value) * strength, 0, 255);
    const t = lifted / 255;
    const curved = t * t * (3 - 2 * t);
    return (t * 0.55 + curved * 0.45) * 255;
  };
}

/**
 * Bilateral filter: a gaussian in space multiplied by a gaussian in colour distance. Flat areas are
 * smoothed as hard as a blur would smooth them, but a real edge keeps its step — which is the whole
 * reason the paint reads as paint instead of as a smudge.
 */
export function bilateral(
  source: Uint8ClampedArray,
  width: number,
  height: number,
  radius: number,
  sigmaSpace = 2.2,
  sigmaRange = 30,
): Float32Array {
  const out = new Float32Array(source.length);
  const side = radius * 2 + 1;
  const space = new Float32Array(side * side);
  let index = 0;
  for (let dy = -radius; dy <= radius; dy += 1) {
    for (let dx = -radius; dx <= radius; dx += 1) {
      space[index] = Math.exp(-(dx * dx + dy * dy) / (2 * sigmaSpace * sigmaSpace));
      index += 1;
    }
  }
  const range = 2 * sigmaRange * sigmaRange;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const p = (y * width + x) * 4;
      const cr = source[p];
      const cg = source[p + 1];
      const cb = source[p + 2];
      let sumR = 0;
      let sumG = 0;
      let sumB = 0;
      let weight = 0;
      let k = 0;
      for (let dy = -radius; dy <= radius; dy += 1) {
        const sy = y + dy < 0 ? 0 : y + dy >= height ? height - 1 : y + dy;
        for (let dx = -radius; dx <= radius; dx += 1, k += 1) {
          const sx = x + dx < 0 ? 0 : x + dx >= width ? width - 1 : x + dx;
          const q = (sy * width + sx) * 4;
          const dr = source[q] - cr;
          const dg = source[q + 1] - cg;
          const db = source[q + 2] - cb;
          const w = space[k] * Math.exp(-(dr * dr + dg * dg + db * db) / range);
          sumR += source[q] * w;
          sumG += source[q + 1] * w;
          sumB += source[q + 2] * w;
          weight += w;
        }
      }
      out[p] = sumR / weight;
      out[p + 1] = sumG / weight;
      out[p + 2] = sumB / weight;
      out[p + 3] = source[p + 3];
    }
  }
  return out;
}

/**
 * Sobel magnitude with hysteresis, the way a Canny does it: strong edges seed, weak edges that touch
 * a strong one survive. The thresholds come from the magnitude histogram, so a flat photo does not
 * come back as one enormous edge and a busy one does not come back blank.
 */
export function edgeMap(gray: Float32Array, width: number, height: number, low = 0.85, high = 0.94): Float32Array {
  const magnitude = new Float32Array(width * height);
  let peak = 0;
  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const i = y * width + x;
      const tl = gray[i - width - 1];
      const t = gray[i - width];
      const tr = gray[i - width + 1];
      const l = gray[i - 1];
      const r = gray[i + 1];
      const bl = gray[i + width - 1];
      const b = gray[i + width];
      const br = gray[i + width + 1];
      const gx = tl + 2 * l + bl - (tr + 2 * r + br);
      const gy = tl + 2 * t + tr - (bl + 2 * b + br);
      const mag = Math.sqrt(gx * gx + gy * gy);
      magnitude[i] = mag;
      if (mag > peak) peak = mag;
    }
  }
  if (peak <= 0) return magnitude;

  const histogram = new Uint32Array(256);
  for (let i = 0; i < magnitude.length; i += 1) histogram[Math.min(255, Math.round((magnitude[i] / peak) * 255))] += 1;
  const pick = (fraction: number): number => {
    const target = magnitude.length * fraction;
    let seen = 0;
    for (let bin = 0; bin < 256; bin += 1) {
      seen += histogram[bin];
      if (seen >= target) return (bin / 255) * peak;
    }
    return peak;
  };
  const highCut = pick(high);
  const lowCut = pick(low);

  const edges = new Float32Array(width * height);
  const weak = new Uint8Array(width * height);
  for (let i = 0; i < magnitude.length; i += 1) {
    if (magnitude[i] >= highCut) edges[i] = 1;
    else if (magnitude[i] >= lowCut) weak[i] = 1;
  }
  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const i = y * width + x;
      if (!weak[i]) continue;
      for (let dy = -1; dy <= 1 && !edges[i]; dy += 1) {
        for (let dx = -1; dx <= 1; dx += 1) {
          if (edges[i + dy * width + dx]) {
            edges[i] = 1;
            break;
          }
        }
      }
    }
  }
  return edges;
}

/**
 * Oklab, because "nearest colour" is a question about eyes, not about coordinates.
 *
 * The palette work used to be done in RGB, where two colours can be far apart numerically and
 * indistinguishable to look at (dark greens) or close numerically and obviously different (a skin tone
 * and the wall behind it). Oklab is a perceptual space: equal distances there are roughly equal
 * differences to a person. The same palette size therefore spends its colours where they can be seen —
 * which is what accuracy means for a colour breaker.
 */
export function srgbToOklabInto(r: number, g: number, b: number, out: Float32Array | number[]): void {
  const linear = (value: number): number => {
    const s = value / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  const R = linear(r);
  const G = linear(g);
  const B = linear(b);
  const l = Math.cbrt(0.4122214708 * R + 0.5363325363 * G + 0.0514459929 * B);
  const m = Math.cbrt(0.2119034982 * R + 0.6806995451 * G + 0.1073969566 * B);
  const s = Math.cbrt(0.0883024619 * R + 0.2817188376 * G + 0.6299787005 * B);
  out[0] = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  out[1] = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  out[2] = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
}

/** The same conversion, for callers that want a value rather than a slot to write into. */
export function srgbToOklab(r: number, g: number, b: number): [number, number, number] {
  const out = new Float32Array(3);
  srgbToOklabInto(r, g, b, out);
  return [out[0], out[1], out[2]];
}

/** Back to the colours a canvas can draw. */
export function oklabToSrgb(L: number, a: number, b: number): [number, number, number] {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const R = 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s;
  const G = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s;
  const B = -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s;
  const encode = (value: number): number => {
    const c = value <= 0.0031308 ? value * 12.92 : 1.055 * Math.max(0, value) ** (1 / 2.4) - 0.055;
    return Math.max(0, Math.min(255, Math.round(c * 255)));
  };
  return [encode(R), encode(G), encode(B)];
}

/** Squared perceptual distance in Oklab. Scalars, because this runs once per pixel per candidate. */
function distanceLab(L: number, a: number, b: number, c: readonly [number, number, number]): number {
  const dL = L - c[0];
  const da = a - c[1];
  const db = b - c[2];
  return dL * dL + da * da + db * db;
}

/**
 * k-means over a deterministic lattice of samples. Seeding from a lattice instead of random points
 * means the same photograph always quantises the same way — which is what makes the look reproducible
 * (and testable).
 */
export function quantise(
  rgba: ArrayLike<number>,
  width: number,
  height: number,
  k: number,
  seed = 1,
): [number, number, number][] {
  const samples: [number, number, number][] = [];
  const step = Math.max(1, Math.floor(Math.sqrt((width * height) / 4096)));
  for (let y = 0; y < height; y += step) {
    for (let x = 0; x < width; x += step) {
      const jitter = hashNoise(x, y, seed) * step * 0.5;
      const px = Math.round(clamp(x + jitter, 0, width - 1));
      const py = Math.round(clamp(y + jitter, 0, height - 1));
      const q = (py * width + px) * 4;
      samples.push([rgba[q], rgba[q + 1], rgba[q + 2]]);
    }
  }
  if (!samples.length) return [[0, 0, 0]];

  // K-means in Oklab. The clusters are chosen by how different two colours look, so a palette of eight
  // spends its colours where the eye can tell them apart rather than where RGB happens to be wide.
  const lab = samples.map(([r, g, b]) => srgbToOklab(r, g, b));
  const centroids: [number, number, number][] = [];
  for (let i = 0; i < k; i += 1) {
    const pick = lab[Math.min(lab.length - 1, Math.floor((i / k) * lab.length))];
    centroids.push([pick[0], pick[1], pick[2]]);
  }

  for (let iteration = 0; iteration < 8; iteration += 1) {
    const sums = centroids.map(() => [0, 0, 0, 0]);
    for (const [L, A, B] of lab) {
      let best = 0;
      let bestDistance = Infinity;
      for (let c = 0; c < centroids.length; c += 1) {
        const d = distanceLab(L, A, B, centroids[c]);
        if (d < bestDistance) {
          bestDistance = d;
          best = c;
        }
      }
      sums[best][0] += L;
      sums[best][1] += A;
      sums[best][2] += B;
      sums[best][3] += 1;
    }
    for (let c = 0; c < centroids.length; c += 1) {
      if (sums[c][3] === 0) continue;
      centroids[c] = [sums[c][0] / sums[c][3], sums[c][1] / sums[c][3], sums[c][2] / sums[c][3]];
    }
  }

  // Back to sRGB, because everything downstream — the flattening, the pull, the ink — draws in the
  // colours the canvas can actually paint.
  return centroids.map(([L, A, B]) => oklabToSrgb(L, A, B));
}

/** The nearest city anchor, and how far away it was — matched by eye, not by RGB. */
export function nearestAnchor(r: number, g: number, b: number): { anchor: readonly [number, number, number]; distance: number } {
  const [L, A, B] = srgbToOklab(r, g, b);
  let best = CITY_PALETTE[0];
  let bestDistance = Infinity;
  for (const anchor of CITY_PALETTE) {
    const [aL, aA, aB] = srgbToOklab(anchor[0], anchor[1], anchor[2]);
    const d = distanceLab(L, A, B, [aL, aA, aB]);
    if (d < bestDistance) {
      bestDistance = d;
      best = anchor;
    }
  }
  // Reported in 8-bit-equivalent units: a full Oklab unit is roughly the whole visible range, so scaling
  // by 255 keeps this number on the same footing as the RGB distance it replaced — and keeps the caller's
  // "how far from an anchor is too far to pull" threshold meaning what it always meant.
  return { anchor: best, distance: Math.sqrt(bestDistance) * 255 };
}

/**
 * Skin, in the loosest useful sense: red above green above blue, not too saturated, not too dark.
 * A face is the one thing a styliser must not ruin — dragging a cheek toward neon pink is exactly
 * what makes these filters look like filters.
 */
export function isSkin(r: number, g: number, b: number): boolean {
  if (r <= g || g <= b) return false;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  if (max < 45) return false;
  const chroma = (max - min) / max;
  return chroma < 0.62 && r - b < 120;
}

/**
 * Connected components over the per-pixel labels, each averaged into one flat colour. This is the
 * step that turns a quantised mosaic into painted regions: neighbouring pixels that share a label
 * stop being individual colours and become one patch.
 */
export function flattenRegions(labels: Uint16Array, smooth: Float32Array, width: number, height: number): Float32Array {
  const flat = new Float32Array(width * height * 4);
  const visited = new Uint8Array(width * height);
  const stack = new Int32Array(width * height);
  const members = new Int32Array(width * height);

  for (let start = 0; start < labels.length; start += 1) {
    if (visited[start]) continue;
    const label = labels[start];
    let top = 0;
    stack[top] = start;
    top += 1;
    visited[start] = 1;
    let count = 0;
    let sumR = 0;
    let sumG = 0;
    let sumB = 0;

    while (top > 0) {
      top -= 1;
      const i = stack[top];
      members[count] = i;
      count += 1;
      const p = i * 4;
      sumR += smooth[p];
      sumG += smooth[p + 1];
      sumB += smooth[p + 2];

      const x = i % width;
      const y = (i - x) / width;
      if (x > 0 && !visited[i - 1] && labels[i - 1] === label) {
        visited[i - 1] = 1;
        stack[top] = i - 1;
        top += 1;
      }
      if (x < width - 1 && !visited[i + 1] && labels[i + 1] === label) {
        visited[i + 1] = 1;
        stack[top] = i + 1;
        top += 1;
      }
      if (y > 0 && !visited[i - width] && labels[i - width] === label) {
        visited[i - width] = 1;
        stack[top] = i - width;
        top += 1;
      }
      if (y < height - 1 && !visited[i + width] && labels[i + width] === label) {
        visited[i + width] = 1;
        stack[top] = i + width;
        top += 1;
      }
    }

    const r = sumR / count;
    const g = sumG / count;
    const b = sumB / count;
    for (let m = 0; m < count; m += 1) {
      const p = members[m] * 4;
      flat[p] = r;
      flat[p + 1] = g;
      flat[p + 2] = b;
      flat[p + 3] = smooth[p + 3];
    }
  }
  return flat;
}

/**
 * The whole look, over one ImageData-shaped buffer. Pure: it reads the input and writes a new buffer.
 */
export function styliseImageData(source: Uint8ClampedArray, width: number, height: number, options: StyliseOptions = {}): Uint8ClampedArray {
  const { colours, palette, ink, finish, light, tone, paper, smooth: smoothStrength, exposure, seed } = {
    ...DEFAULTS,
    ...options,
  };
  const out = new Uint8ClampedArray(source.length);
  const gray = toGray(source, width, height);
  const scale = Math.max(width, height);
  // Exposure first, on the photograph, before anything else looks at it: segmentation, quantisation
  // and the ink all behave badly on a frame that is all in the bottom fifth of the range.
  const curve = exposureAndCurve(source, width, height, exposure);

  // 1. Edge-preserving smoothing. The ink comes from the original luminance: an edge found in an
  //    already-smoothed frame is too late to be crisp.
  const radius = Math.min(3, Math.max(1, Math.round((Math.min(width, height) / 260) * (0.5 + smoothStrength))));
  const smoothed = bilateral(source, width, height, radius, 2.2, 26 + smoothStrength * 26);
  const edges = edgeMap(gray, width, height);

  // 2. Label every pixel by its nearest centroid, then average each connected region into one colour.
  const centroids = quantise(smoothed, width, height, colours, seed);
  // The same perceptual space for the assignment as for the clusters: a pixel goes to the colour it *looks*
  // nearest to. Assignment in RGB while clustering in Oklab would hand back the colours of one space and
  // the decisions of another, which is worse than either.
  const centroidsLab = centroids.map(([r, g, b]) => srgbToOklab(r, g, b));
  const scratch = new Float32Array(3);
  const labels = new Uint16Array(width * height);
  for (let i = 0, p = 0; i < labels.length; i += 1, p += 4) {
    srgbToOklabInto(smoothed[p], smoothed[p + 1], smoothed[p + 2], scratch);
    const L = scratch[0];
    const A = scratch[1];
    const B = scratch[2];
    let best = 0;
    let bestDistance = Infinity;
    for (let c = 0; c < centroidsLab.length; c += 1) {
      const d = distanceLab(L, A, B, centroidsLab[c]);
      if (d < bestDistance) {
        bestDistance = d;
        best = c;
      }
    }
    labels[i] = best;
  }
  const flat = flattenRegions(labels, smoothed, width, height);

  // 3. The palette pull, per region, with a skin guard: a face keeps its own warmth.
  const painted = new Float32Array(flat.length);
  for (let p = 0; p < flat.length; p += 4) {
    const r = flat[p];
    const g = flat[p + 1];
    const b = flat[p + 2];
    const { anchor, distance: away } = nearestAnchor(r, g, b);
    const skin = isSkin(r, g, b);
    const pull = (skin ? palette * 0.18 : palette) * (1 - Math.min(1, away / 200));
    painted[p] = r + (anchor[0] - r) * pull;
    painted[p + 1] = g + (anchor[1] - g) * pull;
    painted[p + 2] = b + (anchor[2] - b) * pull;
    painted[p + 3] = flat[p + 3];
  }

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = y * width + x;
      const p = i * 4;
      let r = painted[p];
      let g = painted[p + 1];
      let b = painted[p + 2];
      const skin = isSkin(r, g, b);

      // 4. Split tone: violet into the shadows, gold into the light. More than any single colour in
      //    the palette, this is what the look actually is.
      const luma = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
      const shadow = Math.max(0, 1 - luma * 2.1) * tone;
      const highlight = Math.max(0, luma - 0.45) * 1.8 * tone;
      const shadowWeight = skin ? shadow * 0.35 : shadow;
      r += -14 * shadowWeight + 46 * highlight;
      g += -4 * shadowWeight + 30 * highlight;
      b += 34 * shadowWeight + 8 * highlight;

      // 5. Exposure and an S-curve, because flat paint still needs punch — and because a photograph
      //    taken at night has to come up into the light before it can be painted at all.
      r = curve(r);
      g = curve(g);
      b = curve(b);

      // 6. Sky bloom: a warm gradient from the top and a low sun off to the right.
      const down = y / height;
      const sunDistance = Math.hypot(x / width - 0.74, down - 0.14);
      const sun = Math.max(0, 1 - sunDistance * 2.2) ** 2 * light;
      const sky = Math.max(0, 1 - down * 2.6);
      const warm = (sky * 0.26 + sun * 0.5) * light;
      r += 88 * warm;
      g += 52 * warm;
      b += 14 * warm;
      if (sun > 0.02) {
        r = 255 - ((255 - r) * (255 - 236 * sun)) / 255;
        g = 255 - ((255 - g) * (255 - 176 * sun)) / 255;
        b = 255 - ((255 - b) * (255 - 108 * sun)) / 255;
      }

      // 7. Ink, multiplied in rather than laid flat on top, so the lines take the colour beneath them.
      if (edges[i] > 0) {
        const weight = ink * 0.8;
        r *= 1 - weight * (1 - 20 / 255);
        g *= 1 - weight * (1 - 14 / 255);
        b *= 1 - weight * (1 - 34 / 255);
      }

      // 8. Paper: two octaves of value noise over the whole frame, the brush the paint came off.
      if (paper > 0) {
        const coarse = valueNoise(x, y, 17, seed);
        const fine = valueNoise(x, y, 4, seed + 7);
        const texture = (coarse * 0.7 + fine * 0.3) * 12 * paper;
        r += texture;
        g += texture;
        b += texture;
      }

      // 9. Finish: vignette, grain, and a touch of print misregistration.
      const centred = Math.hypot(x / width - 0.5, y / height - 0.5) * 1.42;
      const vignette = 1 - finish * 0.4 * Math.max(0, centred - 0.45);
      r *= vignette;
      g *= vignette;
      b *= vignette;

      const grain = hashNoise(x, y, seed) * 8 * finish;
      r += grain;
      g += grain;
      b += grain * 1.15;

      if (finish > 0) {
        const shift = Math.max(1, Math.round(scale / 900));
        const px = Math.min(width - 1, x + shift);
        const other = (y * width + px) * 4;
        const bleed = 0.08 * finish;
        r = r * (1 - bleed) + source[other] * bleed;
        b = b * (1 - bleed) + source[other + 2] * bleed;
      }

      out[p] = clamp(r);
      out[p + 1] = clamp(g);
      out[p + 2] = clamp(b);
      out[p + 3] = source[p + 3];
    }
  }
  return out;
}

/**
 * Does the crop have to be resampled before it is painted?
 *
 * It does whenever the two sizes differ — and "differs" is not the same question as "is bigger than the
 * paint edge". A large crop needs no *upscale* and still needs resampling, because the ceiling may have
 * shrunk the paint below the crop's own size. Answering the wrong question there cost a real group photo
 * its press: the pixels went in at 1280×920 and came back to be written into a 1100×791 frame.
 */
export function needsResample(
  crop: { width: number; height: number },
  paint: { width: number; height: number },
): boolean {
  return paint.width !== crop.width || paint.height !== crop.height;
}

/**
 * The same look over an image element, through a canvas. The only DOM-aware function here, so the
 * maths above stays testable in node.
 */
export function styliseImage(
  image: CanvasImageSource & { width: number; height: number },
  options: StyliseOptions & { maxSize?: number } = {},
): HTMLCanvasElement {
  const { maxSize = 1280, ...look } = options;
  const scale = Math.min(1, maxSize / Math.max(image.width, image.height));
  const width = Math.max(1, Math.round(image.width * scale));
  const height = Math.max(1, Math.round(image.height * scale));

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("this browser has no 2d canvas context");
  ctx.drawImage(image, 0, 0, width, height);

  const pixels = ctx.getImageData(0, 0, width, height);
  const stylised = styliseImageData(pixels.data, width, height, look);
  // Written through createImageData rather than the constructor: the constructor's typing wants an
  // ArrayBuffer-backed view, and a plain Uint8ClampedArray is not assignable to it.
  const pressed = ctx.createImageData(width, height);
  pressed.data.set(stylised);
  ctx.putImageData(pressed, 0, 0);
  return canvas;
}

/**
 * The finish, as opposed to the look.
 *
 * A look decides the *mood* — tone, light, how hard the palette pull is. This decides how much work the
 * press does, and it overrides only the colour work.
 *
 * The two finishes have to be *visible*, or the control is theatre. Fast is deliberately further from
 * the photograph than the look alone: fewer colours, a harder pull, a touch more grain. Fine keeps
 * more of the photograph's own colour, at a larger size. The unit test measures the gap between them,
 * because "it looked the same to me" is the failure mode this has to avoid.
 */
export const FAST: StyliseOptions = {
  colours: 8,
  palette: 0.68,
  paper: 0.34,
};

export const FINE: StyliseOptions = {
  // 32 rather than 24 because it was measured, not guessed: on the photograph-like frame in
  // tests/unit/accuracy.test.ts, 24 colours land within ΔE 0.05 on 99.9% of pixels at a mean error of
  // 0.0119, and 32 at 0.0104 — a 12% lower average error for the finish whose whole job is truer colour.
  colours: 32,
  palette: 0.34,
  ink: 0.16,
  paper: 0.16,
  smooth: 0.4,
  exposure: 0.6,
};

/** Named presets, so the intake can offer a look instead of a wall of numbers. */
export const LOOKS: Record<string, { label: string; blurb: string; options: StyliseOptions }> = {
  dusk: {
    label: "Dusk",
    blurb: "violet shadows, gold light — the city at seven",
    options: { tone: 0.5, light: 0.32, palette: 0.5, colours: 9 },
  },
  neon: {
    label: "Neon",
    blurb: "harder lines, pink in the wet",
    options: { tone: 0.62, light: 0.2, palette: 0.62, colours: 7, ink: 0.68 },
  },
  golden: {
    label: "Golden hour",
    blurb: "the sun is low and everything is warm",
    options: { tone: 0.38, light: 0.55, palette: 0.42, colours: 11 },
  },
  night: {
    label: "Night",
    blurb: "deep and cool, cyan over the water",
    options: { tone: 0.55, light: 0.12, palette: 0.55, colours: 8, finish: 0.65 },
  },
};
