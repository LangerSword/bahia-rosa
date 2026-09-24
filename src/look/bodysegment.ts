import { FilesetResolver, ImageSegmenter, type MPMask } from "@mediapipe/tasks-vision";

/**
 * The cut, done by a model instead of a guess.
 *
 * Region growing was the wrong tool for this job: on a real photograph — busy background, mixed
 * light, a subject the same value as the wall behind them — a flood fill either leaks into the room
 * or eats the person's hair, and when it fails the press falls back to painting the whole frame, which
 * is the recolour everyone can spot instantly. The fix is an actual body-segmentation model.
 *
 * This one is MediaPipe's `selfie_multiclass_256x256` (Apache-2.0), running in the browser with no
 * key, no account and no upload: the model and the wasm runtime are served from this site's own
 * origin, so nothing about the visitor's photo leaves the page. It classifies every pixel as
 * background, hair, body-skin, face-skin, clothes or accessory — which is exactly the question the
 * press needs answered, and it answers it for a face in shadow, a subject at night, and a figure at
 * the edge of a group shot.
 *
 * The classic region-growing cut stays as the fallback for the case where the model cannot load at
 * all (offline, a blocked asset, an old browser), and the fallback is reported to the visitor rather
 * than hidden.
 */

export interface BodyCut {
  /** 0..255 per pixel at the frame's own size: 255 is the person. */
  alpha: Uint8ClampedArray;
  box: { x: number; y: number; width: number; height: number };
  /** Fraction of the frame the person covers, 0..1. */
  share: number;
  source: "model" | "classic";
}

/** Class ids from the multiclass model: 0 is background; everything else is a part of the person. */
const BACKGROUND = 0;

const asset = (path: string): string => `${import.meta.env.BASE_URL}${path}`;

let segmenterPromise: Promise<ImageSegmenter | null> | null = null;

/**
 * The model, loaded once per page and kept. The first press pays for it (16MB, and the browser caches
 * it), every press after that is inference only.
 */
export async function loadSegmenter(onNote?: (stage: string) => void): Promise<ImageSegmenter | null> {
  if (!segmenterPromise) {
    segmenterPromise = (async () => {
      try {
        onNote?.("loading the segmenter");
        const vision = await FilesetResolver.forVisionTasks(asset("mediapipe/wasm"));
        return await ImageSegmenter.createFromOptions(vision, {
          baseOptions: { modelAssetPath: asset("models/selfie_multiclass.tflite"), delegate: "GPU" },
          runningMode: "IMAGE",
          outputCategoryMask: true,
          outputConfidenceMasks: false,
        });
      } catch {
        // A dead asset or an older browser is not a dead press: the classic cut takes over.
        return null;
      }
    })();
  }
  return segmenterPromise;
}

/** A component this fraction of the largest one is part of the group rather than a speckle. */
const GROUP_SHARE = 0.18;
/**
 * The noise floor, as a fraction of the frame rather than a fixed pixel count — the mask arrives at the
 * model's own resolution, so an absolute number would mean something different at every size. 0.4 % of a
 * 256×256 mask is about a face at the back of a group; anything smaller is speckle.
 */
const NOISE_SHARE = 0.004;

/**
 * Turn the model's per-pixel classes into a clean person mask.
 *
 * Pure, and therefore testable without a browser or a model: a synthetic class map goes in, a mask comes
 * out. Speckle (a chair classed as hair) is dropped and holes (a dark shirt reading as background) are
 * filled — but *everyone in the frame is kept*, which is the correction that matters here.
 *
 * The old rule was "the largest connected component wins", written for a portrait. On a group photo it
 * is exactly wrong: it keeps whoever happens to be biggest and throws the friends away, which is how a
 * group of four became one person and then a failure. A component survives when it is either a good
 * fraction of the largest (so a group survives) or comfortably bigger than noise (so one small figure in
 * a large frame is not lost either).
 */
export function cleanMask(
  classes: Uint8Array | Uint8ClampedArray,
  width: number,
  height: number,
): { alpha: Uint8ClampedArray; box: BodyCut["box"]; share: number } {
  const pixels = width * height;
  const binary = new Uint8Array(pixels);
  for (let i = 0; i < Math.min(pixels, classes.length); i += 1) {
    binary[i] = classes[i] === BACKGROUND ? 0 : 1;
  }

  // Largest components (plural) — the queue is written at `tail` and read at `head`, both bumped after
  // use. Writing at `tail + 1` and reading at `head` is an off-by-one that silently makes every
  // component one pixel wide, which is how a speckle once became "the subject".
  const label = new Int32Array(pixels).fill(-1);
  const queue = new Int32Array(pixels);
  const sizes: number[] = [];
  let largest = 0;
  let nextLabel = 0;
  for (let start = 0; start < pixels; start += 1) {
    if (binary[start] === 0 || label[start] !== -1) continue;
    let head = 0;
    let tail = 0;
    queue[tail] = start;
    tail += 1;
    label[start] = nextLabel;
    let size = 0;
    while (head < tail) {
      const index = queue[head];
      head += 1;
      size += 1;
      const x = index % width;
      const y = (index - x) / width;
      if (x > 0 && binary[index - 1] === 1 && label[index - 1] === -1) {
        label[index - 1] = nextLabel;
        queue[tail] = index - 1;
        tail += 1;
      }
      if (x < width - 1 && binary[index + 1] === 1 && label[index + 1] === -1) {
        label[index + 1] = nextLabel;
        queue[tail] = index + 1;
        tail += 1;
      }
      if (y > 0 && binary[index - width] === 1 && label[index - width] === -1) {
        label[index - width] = nextLabel;
        queue[tail] = index - width;
        tail += 1;
      }
      if (y < height - 1 && binary[index + width] === 1 && label[index + width] === -1) {
        label[index + width] = nextLabel;
        queue[tail] = index + width;
        tail += 1;
      }
    }
    sizes.push(size);
    if (size > largest) largest = size;
    nextLabel += 1;
  }

  // Everybody who is part of the picture, not just the tallest person in it.
  const noiseFloor = Math.max(24, Math.round(pixels * NOISE_SHARE));
  const keep = sizes.map((size) => size >= Math.max(noiseFloor, largest * GROUP_SHARE));
  const solid = new Uint8Array(pixels);
  for (let i = 0; i < pixels; i += 1) {
    const component = label[i];
    if (component >= 0 && keep[component]) solid[i] = 1;
  }

  // Fill the holes: flood the background inwards from the border. Anything the flood cannot reach is
  // inside the subject — a dark shirt, the shadow under a chin — and belongs to them.
  const outside = new Uint8Array(pixels);
  const floodQueue = new Int32Array(pixels);
  let head = 0;
  let tail = 0;
  const push = (index: number): void => {
    if (solid[index] === 0 && outside[index] === 0) {
      outside[index] = 1;
      floodQueue[tail] = index;
      tail += 1;
    }
  };
  for (let x = 0; x < width; x += 1) {
    push(x);
    push((height - 1) * width + x);
  }
  for (let y = 0; y < height; y += 1) {
    push(y * width);
    push(y * width + width - 1);
  }
  while (head < tail) {
    const index = floodQueue[head];
    head += 1;
    const x = index % width;
    const y = (index - x) / width;
    if (x > 0) push(index - 1);
    if (x < width - 1) push(index + 1);
    if (y > 0) push(index - width);
    if (y < height - 1) push(index + width);
  }

  const alpha = new Uint8ClampedArray(pixels);
  let count = 0;
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  for (let i = 0; i < pixels; i += 1) {
    if (solid[i] === 1 || outside[i] === 0) {
      alpha[i] = 255;
      count += 1;
      const x = i % width;
      const y = (i - x) / width;
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
  }

  const box =
    maxX < 0
      ? { x: 0, y: 0, width, height }
      : { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 };
  return { alpha, box, share: count / pixels };
}

/**
 * Cut the person out of a frame the browser already has in memory.
 *
 * Returns null when the model is unavailable, so the caller can fall back deliberately rather than
 * silently painting a recolour and calling it a cut-out.
 */
export async function bodyCut(
  canvas: HTMLCanvasElement,
  width: number,
  height: number,
  onNote?: (stage: string) => void,
): Promise<BodyCut | null> {
  const segmenter = await loadSegmenter(onNote);
  if (!segmenter) return null;
  try {
    const result = segmenter.segment(canvas);
    const mask = result.categoryMask as MPMask | undefined;
    if (!mask) return null;
    const classes = mask.getAsUint8Array();
    const maskWidth = mask.width;
    const maskHeight = mask.height;
    const cleaned = cleanMask(classes, maskWidth, maskHeight);
    mask.close();

    // Resample the mask up to the working size through a canvas, which gives the edges a little
    // softness for free — a hard 256px mask scaled to 1600px looks like a paper cut-out.
    const maskCanvas = document.createElement("canvas");
    maskCanvas.width = maskWidth;
    maskCanvas.height = maskHeight;
    const maskCtx = maskCanvas.getContext("2d");
    if (!maskCtx) return null;
    const maskImage = maskCtx.createImageData(maskWidth, maskHeight);
    for (let i = 0; i < cleaned.alpha.length; i += 1) maskImage.data[i * 4 + 3] = cleaned.alpha[i];
    maskCtx.putImageData(maskImage, 0, 0);

    const scaled = document.createElement("canvas");
    scaled.width = width;
    scaled.height = height;
    const scaledCtx = scaled.getContext("2d");
    if (!scaledCtx) return null;
    scaledCtx.imageSmoothingEnabled = true;
    scaledCtx.imageSmoothingQuality = "high";
    scaledCtx.drawImage(maskCanvas, 0, 0, maskWidth, maskHeight, 0, 0, width, height);
    const alphaData = scaledCtx.getImageData(0, 0, width, height).data;

    const alpha = new Uint8ClampedArray(width * height);
    let count = 0;
    for (let i = 0; i < alpha.length; i += 1) {
      alpha[i] = alphaData[i * 4 + 3];
      if (alpha[i] > 127) count += 1;
    }
    return { alpha, box: cleaned.box, share: count / (width * height), source: "model" };
  } catch {
    return null;
  }
}