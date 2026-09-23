import { drawBackdrop, type BackdropId } from "./backdrops";
import { faceBox, subjectMask } from "./segment";
import { styliseImageData, type StyliseOptions } from "./stylise";

/**
 * One photograph in, one painted frame of the city out.
 *
 * The order is the whole trick, and it took a wrong turn to find it:
 *
 *   1. find the subject (border-seeded region growing, see segment.ts)
 *   2. paint the subject with the city's light — palette, split tone, ink, a face guard
 *   3. paint the backdrop behind them
 *   4. composite the subject in over it, feathered, with a rim light and a contact shadow
 *   5. grade the whole frame once more, together, so the person and the city share one light
 *
 * Step 5 is what stops the result looking like a cut-out on a wallpaper: a single pass over the
 * finished composite pulls both halves toward the same palette and grain.
 */

export interface PortraitOptions extends StyliseOptions {
  backdrop?: BackdropId;
  /** Skip the cut-out and paint the whole frame (the old behaviour, kept as a fallback). */
  wholeFrame?: boolean;
  /** Longest edge of the output, in pixels. */
  maxSize?: number;
  /** Seconds since the scene opened — only used when the backdrop animates. */
  time?: number;
  /** Called as each stage begins, for an honest progress line. */
  onStage?: (stage: string) => void;
}

export interface PortraitResult {
  canvas: HTMLCanvasElement;
  /** Fraction of the frame the subject covers, 0..1. 0 means no cut was found. */
  share: number;
  /** True when the subject was cut out; false when the whole frame was painted instead. */
  cutOut: boolean;
  backdrop: BackdropId;
}

/**
 * Paint one frame. DOM-only (canvas + the optional face detector); all the maths lives in the
 * modules this one calls, which is where it is tested.
 */
export async function portraitFromImage(
  image: CanvasImageSource & { width: number; height: number },
  options: PortraitOptions = {},
): Promise<PortraitResult> {
  const { backdrop = "dusk", wholeFrame = false, maxSize = 1280, time = 0, onStage, ...look } = options;
  const scale = Math.min(1, maxSize / Math.max(image.width, image.height));
  const width = Math.max(1, Math.round(image.width * scale));
  const height = Math.max(1, Math.round(image.height * scale));

  onStage?.("reading your photo");
  const photo = document.createElement("canvas");
  photo.width = width;
  photo.height = height;
  const photoCtx = photo.getContext("2d");
  if (!photoCtx) throw new Error("this browser has no 2d canvas context");
  photoCtx.drawImage(image, 0, 0, width, height);

  const frame = photoCtx.getImageData(0, 0, width, height);

  onStage?.("painting you in the city's light");
  const painted = styliseImageData(frame.data, width, height, look);

  let mask: Uint8ClampedArray | null = null;
  let share = 0;
  if (!wholeFrame) {
    onStage?.("finding you in the frame");
    const keep = await faceBox(image);
    const subject = subjectMask(frame.data, width, height, { keep });
    // A cut that found almost nothing, or almost everything, is wrong — and a wrong cut is worse
    // than no cut at all. Fall back to painting the whole frame.
    if (subject.share > 0.015 && subject.share < 0.985) {
      mask = subject.mask;
      share = subject.share;
    }
  }

  onStage?.("building the city behind you");
  const out = document.createElement("canvas");
  out.width = width;
  out.height = height;
  const ctx = out.getContext("2d");
  if (!ctx) throw new Error("this browser has no 2d canvas context");
  drawBackdrop(ctx, width, height, backdrop, time, look.seed ?? 1);

  // The subject, at full frame size, drawn through its own alpha.
  const subjectCanvas = document.createElement("canvas");
  subjectCanvas.width = width;
  subjectCanvas.height = height;
  const subjectCtx = subjectCanvas.getContext("2d");
  if (!subjectCtx) throw new Error("this browser has no 2d canvas context");
  const paintedImage = subjectCtx.createImageData(width, height);
  paintedImage.data.set(painted);
  subjectCtx.putImageData(paintedImage, 0, 0);

  if (mask) {
    onStage?.("placing you in it");
    // A rim light along the subject, from the sun's side, and a contact shadow under them: the two
    // cheap things that make a composite stop looking pasted.
    subjectCtx.save();
    subjectCtx.globalCompositeOperation = "destination-in";
    const alpha = subjectCtx.createImageData(width, height);
    for (let i = 0; i < mask.length; i += 1) alpha.data[i * 4 + 3] = mask[i];
    const maskCanvas = document.createElement("canvas");
    maskCanvas.width = width;
    maskCanvas.height = height;
    const maskCtx = maskCanvas.getContext("2d");
    if (maskCtx) {
      maskCtx.putImageData(alpha, 0, 0);
      subjectCtx.drawImage(maskCanvas, 0, 0);
    }
    subjectCtx.restore();

    const shadow = ctx.createRadialGradient(width * 0.5, height * 0.96, 0, width * 0.5, height * 0.96, width * 0.45);
    shadow.addColorStop(0, "rgba(0, 0, 0, 0.5)");
    shadow.addColorStop(1, "rgba(0, 0, 0, 0)");
    ctx.fillStyle = shadow;
    ctx.fillRect(0, height * 0.62, width, height * 0.38);
  }

  ctx.drawImage(subjectCanvas, 0, 0);

  if (mask) {
    ctx.save();
    ctx.globalCompositeOperation = "screen";
    const rim = ctx.createLinearGradient(0, 0, width, height * 0.7);
    rim.addColorStop(0, "rgba(255, 208, 138, 0.22)");
    rim.addColorStop(1, "rgba(255, 122, 61, 0)");
    ctx.fillStyle = rim;
    ctx.drawImage(subjectCanvas, 0, 0);
    ctx.fillRect(0, 0, width, height);
    ctx.restore();
  }

  // The unifying pass: both halves, one palette, one grain. Ink is low here on purpose — the subject
  // already carries its lines, and inking the backdrop again would draw outlines on the sky.
  onStage?.("grading the whole frame");
  const composed = ctx.getImageData(0, 0, width, height);
  const graded = styliseImageData(composed.data, width, height, {
    colours: 14,
    palette: 0.22,
    ink: 0.18,
    tone: look.tone ?? 0.45,
    light: 0,
    paper: look.paper ?? 0.35,
    finish: look.finish ?? 0.55,
    smooth: 0.2,
    seed: look.seed ?? 1,
  });
  const gradedImage = ctx.createImageData(width, height);
  gradedImage.data.set(graded);
  ctx.putImageData(gradedImage, 0, 0);

  return { canvas: out, share, cutOut: Boolean(mask), backdrop };
}