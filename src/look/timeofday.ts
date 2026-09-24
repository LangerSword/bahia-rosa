/**
 * Time of day — and the fact that it has to be *visible*.
 *
 * The look presets used to change only the paint the subject is drawn with, so choosing "Neon" left the
 * beach at golden hour and the city never changed its light. That is the bug the brief calls out: a
 * time of day that does not change the time of day.
 *
 * So a look now grades the *scene* as well — the sky, the water, the asphalt, the windows — before the
 * subject is placed into it. The grade is split-toned (one tint into the shadows, a different one into
 * the highlights), which is what separates dusk from night from neon at a glance, and it is pure
 * arithmetic on pixels so it can be tested without a canvas:
 *
 *   dusk    violet shadows, warm rim — seven o'clock, the sun just off the water
 *   golden  the low sun wins: everything warm, blacks lifted, contrast soft
 *   neon    magenta in the wet, cyan in the glass: the hour when the signs are brighter than the sky
 *   night   the sky goes deep blue and the lit windows carry the frame
 */

export interface Grade {
  /** Multiply per channel, around 1. */
  gain: [number, number, number];
  /** Add per channel, signed — the exposure move. */
  lift: [number, number, number];
  /** Tint pushed into everything below mid-grey. */
  shadows: [number, number, number];
  /** Tint pushed into everything above it. */
  highlights: [number, number, number];
  /** Channel-mean saturation multiplier. */
  saturation: number;
  /** Contrast around mid-grey. */
  contrast: number;
}

export const GRADES: Record<string, Grade> = {
  dusk: {
    gain: [1.06, 1.0, 0.94],
    lift: [8, 2, 14],
    shadows: [22, 4, 38],
    highlights: [46, 26, -6],
    saturation: 1.14,
    contrast: 1.04,
  },
  golden: {
    gain: [1.12, 1.02, 0.84],
    lift: [18, 8, -6],
    shadows: [30, 16, 0],
    highlights: [58, 34, -12],
    saturation: 1.1,
    contrast: 1.0,
  },
  neon: {
    gain: [1.0, 0.96, 1.1],
    lift: [6, -2, 12],
    shadows: [44, 0, 54],
    highlights: [-8, 16, 48],
    saturation: 1.34,
    contrast: 1.14,
  },
  night: {
    gain: [0.84, 0.9, 1.1],
    lift: [-6, -4, 10],
    shadows: [2, 6, 34],
    highlights: [-14, 2, 34],
    saturation: 1.06,
    contrast: 1.12,
  },
};

/** Unknown ids fall back to dusk rather than to no grade at all: a look must always do something. */
export function gradeFor(look: string): Grade {
  return GRADES[look] ?? GRADES.dusk;
}

/** True when this look has a grade of its own — used by the picker to label what it is showing. */
export function hasGrade(look: string): boolean {
  return look in GRADES;
}

function clamp255(value: number): number {
  return value < 0 ? 0 : value > 255 ? 255 : value;
}

/**
 * Apply a grade to RGBA pixels. Pure: a new buffer comes back, the source is untouched, and two runs
 * over the same input give the same output — which is what makes it testable and what keeps the
 * published frame reproducible from the same photo.
 */
export function gradePixels(source: Uint8ClampedArray, grade: Grade): Uint8ClampedArray {
  const out = new Uint8ClampedArray(source.length);
  const [gr, gg, gb] = grade.gain;
  const [lr, lg, lb] = grade.lift;
  const [sr, sg, sb] = grade.shadows;
  const [hr, hg, hb] = grade.highlights;

  for (let i = 0; i < source.length; i += 4) {
    const r = source[i];
    const g = source[i + 1];
    const b = source[i + 2];
    const a = source[i + 3];

    // Contrast around mid-grey, then the gain, then the exposure lift.
    let nr = (r - 128) * grade.contrast + 128;
    let ng = (g - 128) * grade.contrast + 128;
    let nb = (b - 128) * grade.contrast + 128;
    nr = nr * gr + lr;
    ng = ng * gg + lg;
    nb = nb * gb + lb;

    // Split tone: dark pixels take the shadow tint, bright ones the highlight tint, and the two cross
    // over in the middle so nothing bands.
    const luma = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
    const dark = 1 - luma;
    nr += sr * dark + hr * luma;
    ng += sg * dark + hg * luma;
    nb += sb * dark + hb * luma;

    // Saturation, pulled toward the pixel's own luma so it cannot blow a channel out.
    const grey = 0.2126 * nr + 0.7152 * ng + 0.0722 * nb;
    nr = grey + (nr - grey) * grade.saturation;
    ng = grey + (ng - grey) * grade.saturation;
    nb = grey + (nb - grey) * grade.saturation;

    out[i] = clamp255(nr);
    out[i + 1] = clamp255(ng);
    out[i + 2] = clamp255(nb);
    out[i + 3] = a;
  }
  return out;
}