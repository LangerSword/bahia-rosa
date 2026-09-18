/**
 * The portrait toon pass — the whole "GTA-style illustration" look, in the browser, for $0.
 * Pipeline: median smoothing (kills skin texture, keeps edges) -> posterize -> saturation push
 * -> Sobel ink overlay. No model, no key, no upload.
 *
 * Plan reference: §3.4. Session B implements this fully; the pure maths lands first (TDD).
 */

export interface ToonOptions {
  /** Posterisation steps per channel. */
  levels?: number;
  /** Saturation multiplier applied before posterising. */
  sat?: number;
  /** Sobel magnitude above which a pixel is drawn as ink. */
  ink?: number;
  /** Number of 3x3 median passes. */
  smoothPasses?: number;
}

export const TOON_DEFAULTS: Required<ToonOptions> = {
  levels: 7,
  sat: 1.28,
  ink: 62,
  smoothPasses: 2,
};

/** Quantise a single 0-255 channel value to `levels` steps. */
export function posterize(value: number, levels: number): number {
  if (levels < 2) return value;
  const step = Math.round((value / 255) * (levels - 1));
  return Math.round((step / (levels - 1)) * 255);
}

/** Median of nine numbers (used by median3); avoids allocations of a full sort. */
export function median9(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[4];
}

/**
 * 3x3 median filter per colour channel. Edges are clamped (nearest-neighbour),
 * so the filter never darkens the border of the frame.
 */
export function median3(src: ImageData): ImageData {
  const { width: w, height: h, data } = src;
  const out = new ImageData(w, h);
  const buf: number[] = new Array(9);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const o = (y * w + x) * 4;
      for (let c = 0; c < 3; c++) {
        let i = 0;
        for (let dy = -1; dy <= 1; dy++) {
          const yy = Math.min(h - 1, Math.max(0, y + dy));
          for (let dx = -1; dx <= 1; dx++) {
            const xx = Math.min(w - 1, Math.max(0, x + dx));
            buf[i++] = data[(yy * w + xx) * 4 + c];
          }
        }
        out.data[o + c] = median9(buf);
      }
      out.data[o + 3] = data[o + 3];
    }
  }
  return out;
}
