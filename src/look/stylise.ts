/**
 * The look, in the browser, with no model.
 *
 * A photo becomes a GTA-VI-flavoured key art by classical image processing — the same class of
 * operations as any "image → contours → geometry" pipeline, just pointed at paint instead of maths:
 *
 *   separable blur  →  Sobel edges with hysteresis  →  edge-preserving flatten  →  k-means palette
 *   →  snap to the city's palette  →  sky bloom  →  ink  →  grain, vignette, misregistration
 *
 * Everything here is deterministic (a fixed lattice seeds the clustering, noise is a hash of the
 * pixel position, never Math.random) and free of DOM APIs below `styliseImageData`, so the whole
 * thing is unit-testable in node and identical on every run.
 *
 * The palette is the city's own, not a generic LUT: the sun over Bahía Rosa is gold, the shadows are
 * deep violet, and the neon is pink and cyan.
 */

/** The anchors every quantised colour is pulled toward. Order matters only for readability. */
export const CITY_PALETTE: readonly [number, number, number][] = [
  [27, 16, 48], // deep violet — shadow
  [58, 32, 82], // dusk violet
  [122, 46, 96], // plum haze
  [214, 58, 96], // neon pink
  [255, 122, 61], // sunset orange
  [255, 196, 92], // gold
  [79, 214, 224], // cyan
  [24, 110, 122], // sea teal
];

export interface StyliseOptions {
  /** How many flat colours the photograph is reduced to before the palette pull. */
  colours?: number;
  /** How hard the result is pulled toward CITY_PALETTE, 0..1. */
  palette?: number;
  /** Ink weight on the edges, 0..1. */
  ink?: number;
  /** Grain and vignette, 0..1. */
  finish?: number;
  /** The warm sky bloom and the low sun, 0..1. Zero leaves the palette exactly as quantised. */
  light?: number;
  /** Changes the grain and the lattice jitter, so the same photo can be printed differently. */
  seed?: number;
}

const DEFAULTS: Required<StyliseOptions> = { colours: 7, palette: 0.55, ink: 0.5, finish: 0.6, light: 0.35, seed: 1 };

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

function toGray(rgba: Uint8ClampedArray, width: number, height: number): Float32Array {
  const gray = new Float32Array(width * height);
  for (let i = 0, p = 0; i < gray.length; i += 1, p += 4) {
    gray[i] = 0.2126 * rgba[p] + 0.7152 * rgba[p + 1] + 0.0722 * rgba[p + 2];
  }
  return gray;
}

/** Separable gaussian, the cheap way: two 1-D passes. */
function blur(source: Float32Array, width: number, height: number, sigma: number, channels = 1): Float32Array {
  const radius = Math.max(1, Math.round(sigma * 2.5));
  const kernel = new Float32Array(radius * 2 + 1);
  let total = 0;
  for (let i = -radius; i <= radius; i += 1) {
    const weight = Math.exp(-(i * i) / (2 * sigma * sigma));
    kernel[i + radius] = weight;
    total += weight;
  }
  for (let i = 0; i < kernel.length; i += 1) kernel[i] /= total;

  const pass = new Float32Array(source.length);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let sum = 0;
      for (let k = -radius; k <= radius; k += 1) {
        const sx = clamp(x + k, 0, width - 1);
        sum += source[(y * width + sx) * channels] * kernel[k + radius];
      }
      pass[(y * width + x) * channels] = sum;
    }
  }
  const out = new Float32Array(source.length);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let sum = 0;
      for (let k = -radius; k <= radius; k += 1) {
        const sy = clamp(y + k, 0, height - 1);
        sum += pass[(sy * width + x) * channels] * kernel[k + radius];
      }
      out[(y * width + x) * channels] = sum;
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

/** Squared distance in RGB — plenty for a palette match, and it keeps k-means cheap. */
function distance(r: number, g: number, b: number, c: readonly [number, number, number]): number {
  const dr = r - c[0];
  const dg = g - c[1];
  const db = b - c[2];
  return dr * dr + dg * dg + db * db;
}

/**
 * k-means over a deterministic lattice of samples. Seeding from a lattice instead of random points
 * means the same photograph always quantises to the same palette — which is what makes the whole
 * styliser reproducible (and testable).
 */
export function quantise(rgba: Uint8ClampedArray, width: number, height: number, k: number, seed = 1): [number, number, number][] {
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

  const centroids: [number, number, number][] = [];
  for (let i = 0; i < k; i += 1) centroids.push([...samples[Math.floor((i / k) * samples.length)]] as [number, number, number]);

  for (let iteration = 0; iteration < 7; iteration += 1) {
    const sums = centroids.map(() => [0, 0, 0, 0]);
    for (const [r, g, b] of samples) {
      let best = 0;
      let bestDistance = Infinity;
      for (let c = 0; c < centroids.length; c += 1) {
        const d = distance(r, g, b, centroids[c]);
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

/** The nearest city anchor, and how far away it was. */
export function nearestAnchor(r: number, g: number, b: number): { anchor: readonly [number, number, number]; distance: number } {
  let best = CITY_PALETTE[0];
  let bestDistance = Infinity;
  for (const anchor of CITY_PALETTE) {
    const d = distance(r, g, b, anchor);
    if (d < bestDistance) {
      bestDistance = d;
      best = anchor;
    }
  }
  return { anchor: best, distance: Math.sqrt(bestDistance) };
}

/**
 * The whole look, over one ImageData-shaped buffer. Pure: it reads the input and writes a new buffer.
 *
 * The order matters. Flattening before quantising is what makes flat painted areas instead of a
 * mosaic; snapping to the palette before the bloom is what keeps the light from washing the palette
 * out; ink last, so outlines stay crisp over everything.
 */
export function styliseImageData(source: Uint8ClampedArray, width: number, height: number, options: StyliseOptions = {}): Uint8ClampedArray {
  const { colours, palette, ink, finish, light, seed } = { ...DEFAULTS, ...options };
  const out = new Uint8ClampedArray(source.length);
  const gray = toGray(source, width, height);

  // 1. Smooth in colour, then cluster and assign from the smoothed frame. Matching the noisy
  // original made neighbouring pixels pick different flat colours, which reads as a mosaic with hard
  // steps rather than as paint; the blur is what makes a region agree with itself.
  const sigma = Math.max(1, Math.min(width, height) / 220);
  const smooth = blur(Float32Array.from(source), width, height, sigma, 4);
  const smoothBytes = new Uint8ClampedArray(source.length);
  for (let i = 0; i < smooth.length; i += 1) smoothBytes[i] = smooth[i];
  const edges = edgeMap(gray, width, height);

  // 2. Quantise the smoothed frame, then snap each colour toward the city's palette.
  const centroids = quantise(smoothBytes, width, height, colours, seed);
  const snapped = centroids.map(([r, g, b]) => {
    const { anchor, distance: away } = nearestAnchor(r, g, b);
    // Pull harder when the colour is already close to an anchor: far-away colours (skin, sky) keep
    // their own character instead of being forced into the neon.
    const pull = palette * (1 - Math.min(1, away / 190));
    return [r + (anchor[0] - r) * pull, g + (anchor[1] - g) * pull, b + (anchor[2] - b) * pull] as [number, number, number];
  });

  const scale = Math.max(width, height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = y * width + x;
      const p = i * 4;
      let r = source[p];
      let g = source[p + 1];
      let b = source[p + 2];

      // Nearest centroid, matched against the smoothed colour so a flat region agrees with itself.
      const sr = smoothBytes[p];
      const sg = smoothBytes[p + 1];
      const sb = smoothBytes[p + 2];
      let best = 0;
      let bestDistance = Infinity;
      for (let c = 0; c < centroids.length; c += 1) {
        const d = distance(sr, sg, sb, centroids[c]);
        if (d < bestDistance) {
          bestDistance = d;
          best = c;
        }
      }
      // Paint, not a filter: away from the lines a pixel becomes the flat colour almost entirely, and
      // even on a line most of it does. Keeping a fifth of the photograph's own noise (the first
      // version) left a grade with grain on it rather than flat areas with ink over them.
      const flatness = edges[i] > 0 ? 0.62 : 0.94;
      r += (snapped[best][0] - r) * flatness;
      g += (snapped[best][1] - g) * flatness;
      b += (snapped[best][2] - b) * flatness;

      // 3. Sky bloom: a warm gradient from the top and a low sun off to the right.
      const down = y / height;
      const sunDistance = Math.hypot(x / width - 0.74, down - 0.14);
      const sun = Math.max(0, 1 - sunDistance * 2.2) ** 2 * light;
      const sky = Math.max(0, 1 - down * 2.6);
      const warm = (sky * 0.3 + sun * 0.55) * light;
      r += 92 * warm;
      g += 54 * warm;
      b += 12 * warm;
      if (sun > 0.02) {
        // screen the sun in, so highlights glow instead of clipping to white
        r = 255 - ((255 - r) * (255 - 236 * sun)) / 255;
        g = 255 - ((255 - g) * (255 - 176 * sun)) / 255;
        b = 255 - ((255 - b) * (255 - 108 * sun)) / 255;
      }

      // 4. Ink over the lines.
      if (edges[i] > 0) {
        const weight = ink * 0.72;
        r += (20 - r) * weight;
        g += (14 - g) * weight;
        b += (32 - b) * weight;
      }

      // 5. Finish: vignette, then grain, then a touch of print misregistration.
      const centred = Math.hypot(x / width - 0.5, y / height - 0.5) * 1.42;
      const vignette = 1 - finish * 0.42 * Math.max(0, centred - 0.45);
      r *= vignette;
      g *= vignette;
      b *= vignette;

      const grain = hashNoise(x, y, seed) * 9 * finish;
      r += grain;
      g += grain;
      b += grain * 1.15;

      if (finish > 0) {
        const shift = Math.max(1, Math.round(scale / 900));
        const px = Math.min(width - 1, x + shift);
        const other = (y * width + px) * 4;
        const bleed = 0.09 * finish;
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
