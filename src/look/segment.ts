/**
 * Who is in the photograph.
 *
 * Before this, the styliser painted the whole frame — the person and the kitchen behind them alike.
 * The city wants a subject: find the person, keep them, and put them somewhere.
 *
 * No model. This is the classic approach, which is what "image → contours" tools have always done:
 *
 *   1. seed from the border, grow the background by colour similarity, stop at edges
 *   2. whatever the background never reached is the subject
 *   3. keep the biggest subject region (a photo has one person, not five)
 *   4. fill the holes inside it (a dark shirt tongue, a shadow between arm and body)
 *   5. protect the face, from the browser's own detector when it has one, from a skin pass otherwise
 *   6. feather the edge, so the composite has no cut-out ring
 *
 * Deterministic, DOM-free, and testable on a frame whose answer we already know.
 */

export interface SubjectOptions {
  /** How different a pixel may be from the growing background before it is "not background". */
  tolerance?: number;
  /** Grow the background from the border only (default) — the safest assumption for a portrait. */
  borderOnly?: boolean;
  /** Feather the final mask, in pixels. */
  feather?: number;
  /** Force a subject region, in pixels (`[x, y, w, h]`) — a face box, if the browser found one. */
  keep?: [number, number, number, number] | null;
}

export interface Subject {
  /** 0 = background, 255 = subject, feathered between. */
  mask: Uint8ClampedArray;
  /** Bounding box of the subject in the frame. */
  box: { x: number; y: number; width: number; height: number };
  /** Fraction of the frame the subject covers, 0..1. */
  share: number;
}

const DEFAULT_TOLERANCE = 46;

function toLab(r: number, g: number, b: number): [number, number, number] {
  // Cheap perceptual-ish space: luminance first, then the two colour opponents. Good enough to tell
  // a person from a wall, and far cheaper than a real Lab conversion per pixel.
  const l = 0.299 * r + 0.587 * g + 0.114 * b;
  return [l, r - g, g - b];
}

function distance(a: [number, number, number], b: [number, number, number]): number {
  const d0 = a[0] - b[0];
  const d1 = a[1] - b[1];
  const d2 = a[2] - b[2];
  return Math.sqrt(d0 * d0 + d1 * d1 + d2 * d2);
}

/** A face detector, if this browser has one. Chrome ships the Shape Detection API; others do not. */
export function faceBox(
  image: CanvasImageSource & { width: number; height: number },
): Promise<[number, number, number, number] | null> {
  const Detector = (globalThis as { FaceDetector?: new (options?: { fastMode?: boolean }) => { detect(source: CanvasImageSource): Promise<{ boundingBox: DOMRectReadOnly }[]> } }).FaceDetector;
  if (!Detector) return Promise.resolve(null);
  try {
    return new Detector({ fastMode: true })
      .detect(image)
      .then((faces) => {
        if (!faces.length) return null;
        const box = faces[0].boundingBox;
        // A head is bigger than a face: grow the box before trusting it as "keep this".
        const grow = box.height * 0.9;
        return [
          Math.round(box.x - grow * 0.6),
          Math.round(box.y - grow),
          Math.round(box.width + grow * 1.2),
          Math.round(box.height + grow * 1.5),
        ] as [number, number, number, number];
      })
      .catch(() => null);
  } catch {
    return Promise.resolve(null);
  }
}

/** Loose skin test, shared with the styliser's guard: red over green over blue, not too saturated. */
export function skinish(r: number, g: number, b: number): boolean {
  if (r <= g || g <= b) return false;
  const max = Math.max(r, g, b);
  if (max < 45) return false;
  return (max - Math.min(r, g, b)) / max < 0.62 && r - b < 120;
}

/**
 * The mask. Border-seeded region growing, then the four clean-up passes.
 */
export function subjectMask(
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
  options: SubjectOptions = {},
): Subject {
  const tolerance = options.tolerance ?? DEFAULT_TOLERANCE;
  const feather = options.feather ?? 2;
  const keep = options.keep ?? null;

  const total = width * height;
  const lab = new Float32Array(total * 3);
  for (let i = 0, p = 0; i < total; i += 1, p += 4) {
    const [l, a, b] = toLab(rgba[p], rgba[p + 1], rgba[p + 2]);
    lab[i * 3] = l;
    lab[i * 3 + 1] = a;
    lab[i * 3 + 2] = b;
  }
  const at = (i: number): [number, number, number] => [lab[i * 3], lab[i * 3 + 1], lab[i * 3 + 2]];

  // 1. Region growing from the border. The queue holds pixels known to be background; a neighbour
  //    joins it when it is close enough to the background it came from. Edges stop the growth, which
  //    is exactly why a person survives it.
  const isBackground = new Uint8Array(total);
  const queue = new Int32Array(total);
  let head = 0;
  let tail = 0;

  const seed = (i: number): void => {
    if (isBackground[i]) return;
    isBackground[i] = 1;
    queue[tail] = i;
    tail += 1;
  };
  for (let x = 0; x < width; x += 1) {
    seed(x);
    seed((height - 1) * width + x);
  }
  for (let y = 0; y < height; y += 1) {
    seed(y * width);
    seed(y * width + width - 1);
  }

  while (head < tail) {
    const i = queue[head];
    head += 1;
    const current = at(i);
    const x = i % width;
    const y = (i - x) / width;
    const visit = (n: number): void => {
      if (isBackground[n]) return;
      if (distance(current, at(n)) <= tolerance) seed(n);
    };
    if (x > 0) visit(i - 1);
    if (x < width - 1) visit(i + 1);
    if (y > 0) visit(i - width);
    if (y < height - 1) visit(i + width);
  }

  // 2. The subject is what the background never reached.
  const mask = new Uint8ClampedArray(total);
  for (let i = 0; i < total; i += 1) mask[i] = isBackground[i] ? 0 : 255;

  // 3. Keep the largest subject region. Region-growing sometimes leaks and leaves a second blob
  //    (a reflection, a dark corner); the person is the big one.
  const visited = new Uint8Array(total);
  const stack = new Int32Array(total);
  const members = new Int32Array(total);
  let biggest: Int32Array | null = null;
  let biggestSize = 0;
  for (let start = 0; start < total; start += 1) {
    if (visited[start] || mask[start] === 0) continue;
    let top = 0;
    stack[top] = start;
    top += 1;
    visited[start] = 1;
    let count = 0;
    while (top > 0) {
      top -= 1;
      const i = stack[top];
      members[count] = i;
      count += 1;
      const x = i % width;
      const y = (i - x) / width;
      if (x > 0 && !visited[i - 1] && mask[i - 1] > 0) {
        visited[i - 1] = 1;
        stack[top] = i - 1;
        top += 1;
      }
      if (x < width - 1 && !visited[i + 1] && mask[i + 1] > 0) {
        visited[i + 1] = 1;
        stack[top] = i + 1;
        top += 1;
      }
      if (y > 0 && !visited[i - width] && mask[i - width] > 0) {
        visited[i - width] = 1;
        stack[top] = i - width;
        top += 1;
      }
      if (y < height - 1 && !visited[i + width] && mask[i + width] > 0) {
        visited[i + width] = 1;
        stack[top] = i + width;
        top += 1;
      }
    }
    if (count > biggestSize) {
      biggestSize = count;
      biggest = members.slice(0, count);
    }
  }
  mask.fill(0);
  if (biggest) for (const i of biggest) mask[i] = 255;

  // 4. Fill the holes: a background-coloured pocket inside the person (a t-shirt, a shadow under the
  //    chin) is painted as a hole and reads as a window into the backdrop.
  const holes = new Uint8Array(total);
  holes.fill(1);
  for (const i of biggest ?? []) holes[i] = 0;
  const holeQueue = new Int32Array(total);
  let holeHead = 0;
  let holeTail = 0;
  for (let x = 0; x < width; x += 1) {
    for (const i of [x, (height - 1) * width + x]) {
      if (holes[i] === 1) {
        holes[i] = 2;
        holeQueue[holeTail] = i;
        holeTail += 1;
      }
    }
  }
  for (let y = 0; y < height; y += 1) {
    for (const i of [y * width, y * width + width - 1]) {
      if (holes[i] === 1) {
        holes[i] = 2;
        holeQueue[holeTail] = i;
        holeTail += 1;
      }
    }
  }
  while (holeHead < holeTail) {
    const i = holeQueue[holeHead];
    holeHead += 1;
    const x = i % width;
    const y = (i - x) / width;
    const visit = (n: number): void => {
      if (holes[n] === 1) {
        holes[n] = 2;
        holeQueue[holeTail] = n;
        holeTail += 1;
      }
    };
    if (x > 0) visit(i - 1);
    if (x < width - 1) visit(i + 1);
    if (y > 0) visit(i - width);
    if (y < height - 1) visit(i + width);
  }
  for (let i = 0; i < total; i += 1) if (holes[i] === 1) mask[i] = 255;

  // 5. A face box is authoritative: whatever the growing thought of a cheek, the face stays.
  if (keep) {
    const [x0, y0, w, h] = keep;
    for (let y = Math.max(0, y0); y < Math.min(height, y0 + h); y += 1) {
      for (let x = Math.max(0, x0); x < Math.min(width, x0 + w); x += 1) mask[y * width + x] = 255;
    }
  }

  // 6. Feather: a composite with a hard 1-pixel edge is the thing that says "pasted".
  if (feather > 0) {
    let current = Float32Array.from(mask);
    for (let pass = 0; pass < feather; pass += 1) {
      const next = new Float32Array(total);
      for (let y = 0; y < height; y += 1) {
        for (let x = 0; x < width; x += 1) {
          const i = y * width + x;
          let sum = current[i] * 4;
          let weight = 4;
          if (x > 0) {
            sum += current[i - 1];
            weight += 1;
          }
          if (x < width - 1) {
            sum += current[i + 1];
            weight += 1;
          }
          if (y > 0) {
            sum += current[i - width];
            weight += 1;
          }
          if (y < height - 1) {
            sum += current[i + width];
            weight += 1;
          }
          next[i] = sum / weight;
        }
      }
      current = next;
    }
    for (let i = 0; i < total; i += 1) mask[i] = current[i];
  }

  // The box and the share, so the caller can sanity-check the cut (a subject filling 2% of the frame
  // means the growing ate the person, and the caller should fall back to no cut at all).
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  let covered = 0;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (mask[y * width + x] > 128) {
        covered += 1;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) return { mask, box: { x: 0, y: 0, width, height }, share: 0 };
  return {
    mask,
    box: { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 },
    share: covered / total,
  };
}