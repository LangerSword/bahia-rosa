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
  /**
   * Everybody the model saw, before the "is this person big enough to keep" test — speckle removed, but
   * nobody dropped for being small or partly hidden.
   *
   * The surfaces never draw this. It exists for one job: taking people out of a ground that is the
   * visitor's own photograph. A person the plate declines to paint must still be removed from the room
   * behind them, or the frame shows them twice — once painted, once as a copy in the background.
   */
  everyone: Uint8ClampedArray;
  box: { x: number; y: number; width: number; height: number };
  /** Fraction of the frame the person covers, 0..1. */
  share: number;
  /** How many separate people the cut kept — one, or the whole group. */
  subjects: number;
  source: "model" | "classic";
}

/** Class ids from the multiclass model: 0 is background; everything else is a part of the person. */
const BACKGROUND = 0;

/**
 * A class map read from the *confidence*, not from the winning class.
 *
 * An illustration — a poster, a drawing, a cartoon — is out of distribution for a model trained on
 * photographs, and the usual result is a wall: "person" wins nearly everywhere, the mask covers the frame,
 * and the press refuses it (a mask that covers everything is not a cut). The probabilities are still there,
 * so the same information is asked a harder question: only pixels the model is *confident* about count.
 *
 * Exported because it is pure arithmetic over a confidence map, and the case it exists for (a mask that
 * swallowed the frame) is one a unit test can build exactly.
 */
export function strictClasses(soft: Uint8ClampedArray, threshold = 216): Uint8Array {
  const out = new Uint8Array(soft.length);
  for (let i = 0; i < out.length; i += 1) out[i] = soft[i] > threshold ? 1 : 0;
  return out;
}

const asset = (path: string): string => `${import.meta.env.BASE_URL}${path}`;

const segmenters = new Map<string, Promise<ImageSegmenter | null>>();

/**
 * Which model reads the frame.
 *
 *   - `multi` — the six-class selfie segmenter (16.4MB): it separates hair from skin from clothes, which is
 *     why it can put an edge on a hairline instead of on a 256px grid. It is also the entire cost of a press:
 *     measured, everything after "loading the segmenter" was one twelve-second block, and that block *is* the
 *     model.
 *   - `binary` — the single-class selfie segmenter (249KB, the same runtime and licence): person or not, no
 *     hair detail, and it answers in well under a second. The finish called "fast" gets this one, because a
 *     finish whose job is to be quick cannot spend its budget on the model — and the report line says which
 *     finish ran, so the trade is visible rather than implied.
 *
 * Both are loaded once per page and kept; the browser caches the assets either way.
 */
export async function loadSegmenter(
  onNote?: (stage: string) => void,
  model: "multi" | "binary" = "multi",
): Promise<ImageSegmenter | null> {
  const held = segmenters.get(model);
  if (held) return held;
  const segmenterPromise = (async () => {
      try {
        onNote?.(model === "multi" ? "loading the segmenter" : "loading the quick finder");
        const vision = await FilesetResolver.forVisionTasks(asset("mediapipe/wasm"));
        return await ImageSegmenter.createFromOptions(vision, {
          baseOptions: {
            modelAssetPath: asset(model === "multi" ? "models/selfie_multiclass.tflite" : "models/selfie_segmenter.tflite"),
            delegate: "GPU",
          },
          runningMode: "IMAGE",
          outputCategoryMask: true,
          // The per-class probabilities as well as the winning class. The winning class alone gives a
          // mask with one answer per pixel — a hard 256px edge — while the probabilities say *how much*
          // person a pixel is, which is the difference between a cut-out and a paper cut-out. The binary
          // model answers with one mask; there is nothing to ask it twice about.
          outputConfidenceMasks: model === "multi",
        });
      } catch {
        // A dead asset or an older browser is not a dead press: the classic cut takes over.
        return null;
      }
  })();
  segmenters.set(model, segmenterPromise);
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
): {
  alpha: Uint8ClampedArray;
  everyone: Uint8ClampedArray;
  box: BodyCut["box"];
  share: number;
  subjects: number;
} {
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
  // And everybody the model saw at all — speckle removed, but nobody dropped for being small. The ground
  // needs this one: a person the plate refuses to paint must still be taken out of the room behind them, or
  // they stay in the background as a full-size copy of themselves and the frame contains them twice.
  const keepAnyone = sizes.map((size) => size >= noiseFloor);
  // How many people the cut kept, so the report can say "the four of you" instead of a percentage.
  let subjects = 0;
  for (const kept of keep) if (kept) subjects += 1;
  const solid = new Uint8Array(pixels);
  const solidAll = new Uint8Array(pixels);
  for (let i = 0; i < pixels; i += 1) {
    const component = label[i];
    if (component < 0) continue;
    if (keep[component]) solid[i] = 1;
    if (keepAnyone[component]) solidAll[i] = 1;
  }

  /**
   * Fill the holes, then read the mask out.
   *
   * Flood the background inwards from the border: anything the flood cannot reach is inside a person — a
   * dark shirt, the shadow under a chin — and belongs to them. Run once for the people the cut keeps and
   * once for everybody it saw, because the flood has to be computed against the set it is filling.
   */
  const alphaFrom = (seed: Uint8Array) => {
    const outside = new Uint8Array(pixels);
    const floodQueue = new Int32Array(pixels);
    let head = 0;
    let tail = 0;
    const push = (index: number): void => {
      if (seed[index] === 0 && outside[index] === 0) {
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
      if (seed[i] === 1 || outside[i] === 0) {
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
    return { alpha, count, minX, minY, maxX, maxY };
  };

  const kept = alphaFrom(solid);
  const everybody = alphaFrom(solidAll);

  const box =
    kept.maxX < 0
      ? { x: 0, y: 0, width, height }
      : {
          x: kept.minX,
          y: kept.minY,
          width: kept.maxX - kept.minX + 1,
          height: kept.maxY - kept.minY + 1,
        };
  return { alpha: kept.alpha, everyone: everybody.alpha, box, share: kept.count / pixels, subjects };
}

/**
 * The soft mask: how much person the model thinks each pixel is.
 *
 * `1 − P(background)` is the model's own answer to the question the press is asking, and unlike the
 * winning class it is continuous — so the edge of the subject is a ramp rather than a cliff. The ramp is
 * then re-thresholded between two values instead of at one: a pixel is fully person above `ceiling`,
 * fully background below `floor`, and proportional in between. One hard threshold at 0.5 would throw away
 * exactly the information this function exists to keep.
 */
export function softAlphaFromConfidence(
  background: Float32Array | Uint8Array | ArrayLike<number>,
  width: number,
  height: number,
  floor = 0.42,
  ceiling = 0.58,
): Uint8ClampedArray {
  const pixels = width * height;
  const alpha = new Uint8ClampedArray(pixels);
  const span = Math.max(1e-6, ceiling - floor);
  for (let i = 0; i < pixels; i += 1) {
    const person = 1 - (background[i] ?? 1);
    alpha[i] = Math.round(255 * Math.min(1, Math.max(0, (person - floor) / span)));
  }
  return alpha;
}

/** A separable box blur of a single-channel float buffer, edge-clamped. O(n), whatever the radius. */
function boxBlur(source: Float32Array, width: number, height: number, radius: number): Float32Array {
  const horizontal = new Float32Array(source.length);
  const window = radius * 2 + 1;
  for (let y = 0; y < height; y += 1) {
    const row = y * width;
    let sum = 0;
    for (let x = -radius; x <= radius; x += 1) sum += source[row + Math.min(width - 1, Math.max(0, x))];
    for (let x = 0; x < width; x += 1) {
      horizontal[row + x] = sum / window;
      const out = row + Math.min(width - 1, Math.max(0, x - radius));
      const into = row + Math.min(width - 1, Math.max(0, x + radius + 1));
      sum += source[into] - source[out];
    }
  }
  const vertical = new Float32Array(source.length);
  for (let x = 0; x < width; x += 1) {
    let sum = 0;
    for (let y = -radius; y <= radius; y += 1) sum += horizontal[Math.min(height - 1, Math.max(0, y)) * width + x];
    for (let y = 0; y < height; y += 1) {
      vertical[y * width + x] = sum / window;
      const out = Math.min(height - 1, Math.max(0, y - radius)) * width + x;
      const into = Math.min(height - 1, Math.max(0, y + radius + 1)) * width + x;
      sum += horizontal[into] - horizontal[out];
    }
  }
  return vertical;
}

/**
 * Snap the mask's edge to the photograph's own edges.
 *
 * The model answers at 256×256. Scaled to a working frame of 1280px that is a five-pixel step at every
 * boundary, and a soft ramp smooths the step without moving it — hair against a wall still gets a
 * five-pixel-wide smear where the truth is one pixel. This is a guided filter with the photograph's
 * luminance as the guide: inside the filter's window the mask is fitted to the image, so where the image
 * has an edge the mask takes it, and where the image is flat the mask is averaged.
 *
 * It is the "find the edges first, then paint" half of the press: the edge decides where the paint stops.
 */
/**
 * Pull a mask in by a pixel or two.
 *
 * The alpha a segmentation model returns is soft at the boundary, and the boundary pixels are a *mixture* of
 * the person and whatever was behind them. That mixture is what a visitor sees as a pale halo or a sticker's
 * edge — most visibly on a photograph whose subject was in front of a bright, plain wall. Taking the minimum
 * over a small neighbourhood (an erosion) drops the ring of mixed pixels while leaving the person's own edge
 * soft, because the upscale into the frame smooths what remains.
 *
 * Pure: `tests/unit/edge.test.ts` puts a block with a one-pixel fringe through it and measures both the
 * fringe going and the interior staying.
 */
export function shrinkMask(
  alpha: ArrayLike<number>,
  width: number,
  height: number,
  by = 2,
): Uint8ClampedArray {
  const out = new Uint8ClampedArray(width * height);
  if (by <= 0 || width < 3 || height < 3) {
    for (let i = 0; i < out.length; i += 1) out[i] = alpha[i] ?? 0;
    return out;
  }
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let smallest = 255;
      for (let dy = -by; dy <= by && smallest > 0; dy += 1) {
        const ny = y + dy;
        if (ny < 0 || ny >= height) {
          smallest = 0;
          break;
        }
        for (let dx = -by; dx <= by; dx += 1) {
          const nx = x + dx;
          if (nx < 0 || nx >= width) {
            smallest = 0;
            break;
          }
          const value = alpha[ny * width + nx] ?? 0;
          if (value < smallest) smallest = value;
        }
      }
      out[y * width + x] = smallest;
    }
  }
  return out;
}

export function refineEdges(
  alpha: Uint8ClampedArray,
  rgba: ArrayLike<number>,
  width: number,
  height: number,
  options: { radius?: number; iterations?: number; strength?: number; epsilon?: number } = {},
): Uint8ClampedArray {
  // Tuned against the measurement in tests/unit/accuracy.test.ts, not by feel: radius 5 and three passes
  // take a mask that is a five-pixel ramp in the wrong place and move it onto the photograph's edge, while
  // a timid window (radius 2, one pass) barely moves it at all. Full strength is safe here because the
  // filter is edge-preserving by construction — it is the *guide* that decides, and the guide is the photo.
  const { radius = 5, iterations = 3, strength = 1, epsilon = 0.0004 } = options;
  const pixels = width * height;
  if (!pixels || alpha.length < pixels) return alpha;

  // The guide: the photograph's own luminance, 0..1.
  const guide = new Float32Array(pixels);
  for (let i = 0, p = 0; i < pixels; i += 1, p += 4) {
    guide[i] = (0.299 * (rgba[p] ?? 0) + 0.587 * (rgba[p + 1] ?? 0) + 0.114 * (rgba[p + 2] ?? 0)) / 255;
  }

  let mask = new Float32Array(pixels);
  for (let i = 0; i < pixels; i += 1) mask[i] = (alpha[i] ?? 0) / 255;

  for (let iteration = 0; iteration < iterations; iteration += 1) {
    const guideMean = boxBlur(guide, width, height, radius);
    const maskMean = boxBlur(mask, width, height, radius);
    const guideSquared = new Float32Array(pixels);
    const guideMask = new Float32Array(pixels);
    for (let i = 0; i < pixels; i += 1) {
      guideSquared[i] = guide[i] * guide[i];
      guideMask[i] = guide[i] * mask[i];
    }
    const meanGuideSquared = boxBlur(guideSquared, width, height, radius);
    const meanGuideMask = boxBlur(guideMask, width, height, radius);
    const a = new Float32Array(pixels);
    const b = new Float32Array(pixels);
    for (let i = 0; i < pixels; i += 1) {
      const variance = meanGuideSquared[i] - guideMean[i] * guideMean[i];
      const covariance = meanGuideMask[i] - guideMean[i] * maskMean[i];
      const slope = covariance / (variance + epsilon);
      a[i] = slope;
      b[i] = maskMean[i] - slope * guideMean[i];
    }
    const meanA = boxBlur(a, width, height, radius);
    const meanB = boxBlur(b, width, height, radius);
    for (let i = 0; i < pixels; i += 1) {
      const filtered = meanA[i] * guide[i] + meanB[i];
      const kept = mask[i] * (1 - strength) + filtered * strength;
      mask[i] = Math.min(1, Math.max(0, kept));
    }
  }

  const out = new Uint8ClampedArray(alpha.length);
  for (let i = 0; i < pixels; i += 1) out[i] = Math.round(mask[i] * 255);
  return out;
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
  /**
   * How many passes of edge refinement the mask gets. Three is the measured optimum (see
   * `tests/unit/accuracy.test.ts`); one is what a finish called "fast" can afford, and the report line says
   * which finish ran.
   */
  options: { edgePasses?: number; model?: "multi" | "binary" } = {},
): Promise<BodyCut | null> {
  const segmenter = await loadSegmenter(onNote, options.model ?? (options.edgePasses === 1 ? "binary" : "multi"));
  if (!segmenter) return null;
  try {
    const result = segmenter.segment(canvas);
    const mask = result.categoryMask as MPMask | undefined;
    if (!mask) return null;
    const classes = mask.getAsUint8Array();
    const maskWidth = mask.width;
    const maskHeight = mask.height;

    // The probabilities, for the edge: how much person each pixel is, rather than which class won.
    let soft: Uint8ClampedArray | null = null;
    const confidences = result.confidenceMasks;
    if (confidences && confidences.length > BACKGROUND) {
      const background = confidences[BACKGROUND].getAsFloat32Array();
      soft = softAlphaFromConfidence(background, maskWidth, maskHeight);
      for (const confidence of confidences) confidence.close();
    }

    // The winning class still decides *which regions* count — speckle out, holes filled, everyone in the
    // frame kept — and the probabilities decide how each surviving pixel's edge falls.
    const cleaned = cleanMask(classes, maskWidth, maskHeight);
    mask.close();

    // A mask that covers the frame is a threshold that did not bite. Before giving up — and giving up means
    // painting the plate flat, which on a poster looks like the poster recoloured with its own art still in
    // it — the confidences are read strictly. Measured on the real case this exists for (a stylised key-art
    // poster): the winning class covered essentially everything and was refused, and the strict read of the
    // same probabilities produced a figure with a share in the normal range, so the frame got a cut, a
    // ground cleared behind them, and a person who can be arranged.
    const frameShare = cleaned.share;
    const strict = soft && frameShare > 0.94 ? cleanMask(strictClasses(soft), maskWidth, maskHeight) : null;
    const chosen = strict && strict.share > 0.008 && strict.share < frameShare ? strict : cleaned;

    const combined = new Uint8ClampedArray(maskWidth * maskHeight);
    for (let i = 0; i < combined.length; i += 1) {
      if (chosen.alpha[i] === 0) continue; // dropped as speckle, or outside the subject
      // A pixel the model called background but which the flood could not reach is inside the subject —
      // a dark shirt, the shadow under a chin — and stays solid whatever its probability says.
      combined[i] = classes[i] === BACKGROUND ? 255 : (soft?.[i] ?? 255);
    }

    // Resample the mask up to the working size through a canvas, which gives the edges a little
    // softness for free — a hard 256px mask scaled to 1600px looks like a paper cut-out.
    const maskCanvas = document.createElement("canvas");
    maskCanvas.width = maskWidth;
    maskCanvas.height = maskHeight;
    const maskCtx = maskCanvas.getContext("2d");
    if (!maskCtx) return null;
    const maskImage = maskCtx.createImageData(maskWidth, maskHeight);
    for (let i = 0; i < combined.length; i += 1) maskImage.data[i * 4 + 3] = combined[i];
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

    let alpha: Uint8ClampedArray = new Uint8ClampedArray(width * height);
    for (let i = 0; i < alpha.length; i += 1) alpha[i] = alphaData[i * 4 + 3];

    // And then the edge is moved onto the photograph's own edges, at the working resolution where they
    // actually exist. This is the accuracy: a mask that follows the hairline instead of a 256px grid.
    const frame = canvas.getContext("2d")?.getImageData(0, 0, width, height).data;
    if (frame) alpha = refineEdges(alpha, frame, width, height, { iterations: options.edgePasses ?? 3 });

    // Everybody the model saw, at the working size, for the ground's sake — the clear needs this one and
    // never the mask above, because a person the plate declines to paint must still come out of the room
    // behind them. Resampled the same way; not edge-refined, because the clear thresholds it and a soft rim
    // is exactly what stops the fill from leaving a hard edge where somebody was standing.
    const everyoneCanvas = document.createElement("canvas");
    everyoneCanvas.width = maskWidth;
    everyoneCanvas.height = maskHeight;
    const everyoneCtx = everyoneCanvas.getContext("2d");
    if (!everyoneCtx) return null;
    const everyoneImage = everyoneCtx.createImageData(maskWidth, maskHeight);
    for (let i = 0; i < chosen.everyone.length; i += 1) {
      everyoneImage.data[i * 4 + 3] = chosen.everyone[i];
    }
    everyoneCtx.putImageData(everyoneImage, 0, 0);
    const everyoneScaled = document.createElement("canvas");
    everyoneScaled.width = width;
    everyoneScaled.height = height;
    const everyoneScaledCtx = everyoneScaled.getContext("2d");
    if (!everyoneScaledCtx) return null;
    everyoneScaledCtx.imageSmoothingEnabled = true;
    everyoneScaledCtx.imageSmoothingQuality = "high";
    everyoneScaledCtx.drawImage(everyoneCanvas, 0, 0, maskWidth, maskHeight, 0, 0, width, height);
    const everyoneData = everyoneScaledCtx.getImageData(0, 0, width, height).data;
    const everyone = new Uint8ClampedArray(width * height);
    for (let i = 0; i < everyone.length; i += 1) everyone[i] = everyoneData[i * 4 + 3];

    let count = 0;
    for (let i = 0; i < alpha.length; i += 1) if (alpha[i] > 127) count += 1;
    return {
      alpha,
      everyone,
      box: chosen.box,
      share: count / (width * height),
      subjects: chosen.subjects,
      source: "model",
    };
  } catch {
    return null;
  }
}