/**
 * The exporter: one artwork, one placement spec, one PNG.
 *
 * Deliberately dumb — it draws exactly the numbers in `placements.ts`, in the same order the preview
 * stacks them. If the preview and the download ever disagree, the spec is wrong, not the renderer.
 * Nothing here touches the network: the artwork is a data URL the app already holds.
 */

import {
  FEED_AVATAR,
  FONT_STACKS,
  PALETTE,
  fillCopy,
  type Placement,
  type PlacementCopy,
  type TextLayer,
} from "./placements";

/**
 * Fonts must be resident before canvas text, or the export falls back to a system face.
 *
 * The placements all draw in the monospaced stack now — a *system* stack, which is resident by
 * definition. That removes the tab the old version had for a decorative family that might not have
 * loaded yet: `ctx.font` naming an unloaded face draws a fallback **without throwing**, so a slow load
 * would quietly change how the printed product looked. Nothing to load, nothing to race.
 */
export async function readyFonts(): Promise<void> {
  if (typeof document === "undefined" || !document.fonts) return;
  await document.fonts.ready;
}

export function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.crossOrigin = "anonymous";
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("the artwork could not be decoded"));
    image.src = src;
  });
}

/**
 * Where the artwork goes on a surface.
 *
 * Pure geometry, so it is tested without a canvas — and the distinction it encodes is the one that
 * matters to a person looking at their own photograph:
 *
 *   `contain`  the whole photograph fits inside the rect, nothing cropped. The leftover space is a
 *              mount, and the caller draws it as one.
 *   `cover`    the photograph fills the rect and overflows on one axis, biased upward (BIAS_Y) because
 *              the interesting half of a person is the top half — the difference between a portrait
 *              fitted into a wide surface and a portrait sliced at the chin.
 */
const BIAS_Y = 0.4;

export function fitRect(
  image: { width: number; height: number },
  rect: { x: number; y: number; w: number; h: number },
  fit: "cover" | "contain",
  biasY = BIAS_Y,
): { x: number; y: number; w: number; h: number } {
  const scale =
    fit === "cover"
      ? Math.max(rect.w / image.width, rect.h / image.height)
      : Math.min(rect.w / image.width, rect.h / image.height);
  const w = image.width * scale;
  const h = image.height * scale;
  return {
    x: rect.x + (rect.w - w) / 2,
    y: rect.y + (rect.h - h) * (fit === "cover" ? biasY : 0.5),
    w,
    h,
  };
}

function drawFitted(
  ctx: CanvasRenderingContext2D,
  image: HTMLImageElement,
  rect: { x: number; y: number; w: number; h: number },
  fit: "cover" | "contain",
): void {
  const placed = fitRect(image, rect, fit);
  ctx.drawImage(image, placed.x, placed.y, placed.w, placed.h);
}

const groundCache = new Map<string, Promise<HTMLImageElement | null>>();

/** Load a placement's city ground once per src; a missing plate falls back to the gradient. */
export function loadGround(placement: Placement): Promise<HTMLImageElement | null> {
  if (placement.ground.kind !== "image" || !placement.ground.src) return Promise.resolve(null);
  const src = placement.ground.src;
  const cached = groundCache.get(src);
  if (cached) return cached;
  const pending = loadImage(src).catch(() => null);
  groundCache.set(src, pending);
  return pending;
}

function gradient(
  ctx: CanvasRenderingContext2D,
  placement: Placement,
  w: number,
  h: number,
  ground: HTMLImageElement | null,
): void {
  const angle = (placement.ground.angle * Math.PI) / 180;
  const dx = Math.cos(angle) * w;
  const dy = Math.sin(angle) * h;

  if (ground) {
    // The backdrop is scenery, so it is fitted centred — the upward bias belongs to a *subject*, and a
    // skyline that keeps more of its top than its bottom is just a skyline that has been moved.
    const placed = fitRect(ground, { x: 0, y: 0, w, h }, "cover", 0.5);
    ctx.drawImage(ground, placed.x, placed.y, placed.w, placed.h);
    const scrim = ctx.createLinearGradient(0, 0, 0, h);
    const [top, bottom] = placement.ground.scrim ?? ["rgba(7,7,10,0.3)", "rgba(7,7,10,0.9)"];
    scrim.addColorStop(0, top);
    scrim.addColorStop(1, bottom);
    ctx.fillStyle = scrim;
    ctx.fillRect(0, 0, w, h);
    return;
  }

  const fill = ctx.createLinearGradient(0, 0, dx, dy);
  const [from, to] = placement.ground.stops ?? ["#16203f", "#0d0c1a"];
  fill.addColorStop(0, from);
  fill.addColorStop(1, to);
  ctx.fillStyle = fill;
  ctx.fillRect(0, 0, w, h);
}

/** Ellipsise to a width, measured in the real font — user copy is unbounded, the canvas is not. */
function truncate(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string {
  if (ctx.measureText(text).width <= maxWidth) return text;
  let cut = text;
  while (cut.length > 1 && ctx.measureText(`${cut}…`).width > maxWidth) cut = cut.slice(0, -1);
  return `${cut.trimEnd()}…`;
}

function drawText(ctx: CanvasRenderingContext2D, layer: TextLayer, copy: PlacementCopy): void {
  const filled = fillCopy(layer.text, copy);
  const weight = layer.weight ?? 400;
  ctx.font = `${weight} ${layer.size}px ${FONT_STACKS[layer.family]}`;
  const spacing = layer.tracking ? layer.tracking * layer.size : 0;
  const supported = "letterSpacing" in ctx;
  if (supported && spacing) {
    (ctx as CanvasRenderingContext2D & { letterSpacing: string }).letterSpacing = `${spacing}px`;
  }

  let text = layer.upper ? filled.toUpperCase() : filled;
  if (layer.maxWidth) text = truncate(ctx, text, layer.maxWidth);

  ctx.fillStyle = layer.color;
  ctx.textAlign = layer.align ?? "left";
  ctx.textBaseline = "alphabetic";
  ctx.fillText(text, layer.x, layer.y);

  if (supported && spacing) {
    (ctx as CanvasRenderingContext2D & { letterSpacing: string }).letterSpacing = "0px";
  }
}

/** Draw the whole placement. Exported for the tests, which assert against the same numbers. */
/**
 * The subject as a layer you can move, size, cut and let run off the edge.
 *
 * The subject is already composited into the plate before it gets here — this is the *second* layer of
 * control, on the surface: the plate's artwork placed inside the surface's artwork rect. The visitor's
 * decisions are a transform, not a re-render, which is why dragging is instant and why a download is
 * still the same function that drew the preview.
 *
 * Group photos use exactly this and nothing else. Splitting a group into separate people would mean
 * cutting, painting and lighting each one independently — and the paint is what holds the group together
 * (shared light, shared palette, one frame). So the group stays one layer, and gets the same controls a
 * solo photograph gets.
 */
export interface LayerTransform {
  /** Drag, as a fraction of the surface's width and height. 0 is centred. */
  dx: number;
  dy: number;
  /** Size on top of the fitted size: 1 is exactly the fit, 2 is twice it. */
  scale: number;
  /** Cut away from the top and the bottom of the layer, 0..0.6 each — "just the top half of us". */
  cropTop: number;
  cropBottom: number;
  /** Let the layer run past the surface's edge instead of being held inside it. */
  overflow: boolean;
}

export const LAYER_DEFAULT: LayerTransform = {
  dx: 0,
  dy: 0,
  scale: 1,
  cropTop: 0,
  cropBottom: 0,
  overflow: false,
};

/** True when a transform would change nothing — the path that must stay byte-identical to the old one. */
export function isDefaultLayer(layer: LayerTransform | undefined): boolean {
  if (!layer) return true;
  return (
    layer.dx === 0 &&
    layer.dy === 0 &&
    layer.scale === 1 &&
    layer.cropTop === 0 &&
    layer.cropBottom === 0 &&
    !layer.overflow
  );
}

/**
 * Where the layer's pixels come from and where they go.
 *
 * The source rect is the *cut*: cropping the top and bottom of the layer rather than squashing it, so a
 * body with its legs cut away keeps its proportions. The destination is the fitted size for what is left,
 * scaled, moved, and — unless the visitor asked for overflow — held inside the surface.
 */
export function layerGeometry(
  image: { width: number; height: number },
  rect: { x: number; y: number; w: number; h: number },
  transform: LayerTransform = LAYER_DEFAULT,
  fit: "cover" | "contain" = "contain",
): { source: { x: number; y: number; w: number; h: number }; destination: { x: number; y: number; w: number; h: number } } {
  const cropTop = Math.min(0.6, Math.max(0, transform.cropTop));
  const cropBottom = Math.min(0.6, Math.max(0, transform.cropBottom));
  const top = Math.round(image.height * cropTop);
  const bottom = Math.min(image.height - top - 1, Math.round(image.height * cropBottom));
  const source = {
    x: 0,
    y: top,
    w: Math.max(1, image.width),
    h: Math.max(1, image.height - top - bottom),
  };

  const base = fitRect({ width: source.w, height: source.h }, rect, fit);
  const scale = Math.min(4, Math.max(0.05, transform.scale));
  const w = base.w * scale;
  const h = base.h * scale;

  // The anchor is the placement's own: centred in the rect, exactly as the untransformed fit is — so the
  // default transform reproduces the old output to the pixel, and a drag is measured from there.
  let x = rect.x + (rect.w - w) / 2 + transform.dx * rect.w;
  let y = rect.y + (rect.h - h) / 2 + transform.dy * rect.h;

  if (!transform.overflow) {
    // Held inside the surface — but only where there is somewhere to be held *to*. An axis the layer
    // already fills has no slack, and clamping it there meant a drag that did nothing at all: the visitor
    // asked to move their picture and the picture did not move. A control that reads as broken is worse
    // than a picture that shows a gap at one edge, so a full axis is left free.
    const clampAxis = (value: number, start: number, size: number, extent: number): number =>
      size >= extent ? value : Math.min(start + extent - size, Math.max(start, value));
    x = clampAxis(x, rect.x, w, rect.w);
    y = clampAxis(y, rect.y, h, rect.h);
  }

  return { source, destination: { x, y, w, h } };
}

/** The artwork into a rect, through the layer transform — or straight through when there is none. */
function drawLayer(
  ctx: CanvasRenderingContext2D,
  artwork: HTMLImageElement,
  rect: { x: number; y: number; w: number; h: number },
  fit: "cover" | "contain",
  layer?: LayerTransform,
): void {
  if (isDefaultLayer(layer)) {
    drawFitted(ctx, artwork, rect, fit);
    return;
  }
  const { source, destination } = layerGeometry(artwork, rect, layer, fit);
  ctx.drawImage(
    artwork,
    source.x,
    source.y,
    source.w,
    source.h,
    destination.x,
    destination.y,
    destination.w,
    destination.h,
  );
}

export function drawPlacement(
  ctx: CanvasRenderingContext2D,
  placement: Placement,
  artwork: HTMLImageElement,
  copy: PlacementCopy,
  ground: HTMLImageElement | null = null,
  /** Overrides the placement's own default — the visitor's choice, for this download. */
  fitOverride?: "cover" | "contain",
  /** The subject as a layer: moved, sized, cut, or let run off the edge. */
  layer?: LayerTransform,
  /** The person on their own, drawn over the ground and moved by the layer. Without it, just the plate. */
  subject?: HTMLImageElement | null,
): void {
  const { width, height } = placement;
  const fit = fitOverride ?? placement.artwork.fit;
  gradient(ctx, placement, width, height, ground);

  if (placement.bezel) {
    ctx.fillStyle = placement.bezel.color;
    ctx.fillRect(placement.bezel.x, placement.bezel.y, placement.bezel.w, placement.bezel.h);
  }

  if (fit === "contain") {
    // A mount, so a photograph that does not fill the surface reads as *framed* rather than as a
    // mistake. Without this the leftover space would show whatever is behind the artwork rect — the
    // city plate on the feed, which has no bezel of its own.
    ctx.fillStyle = PALETTE.ink;
    ctx.fillRect(placement.artwork.x, placement.artwork.y, placement.artwork.w, placement.artwork.h);
  }

  // The ground is *placed*, never moved: it is the room, and a room does not follow you around. Only the
  // person is a layer — which is what "keep the drawing in a separate layer" means once the picture leaves
  // the press, and why a drag moves them over their background instead of dragging the whole frame.
  drawFitted(ctx, artwork, placement.artwork, fit);
  if (subject) drawLayer(ctx, subject, placement.artwork, fit, layer);

  if (fit === "contain" && isDefaultLayer(layer)) {
    // And the photograph's own edge, so the mount is a mount and not a shadow.
    const placed = fitRect(artwork, placement.artwork, "contain");
    ctx.strokeStyle = PALETTE.rule;
    ctx.lineWidth = 2;
    ctx.strokeRect(placed.x, placed.y, placed.w, placed.h);
  }

  for (const rule of placement.rules) {
    ctx.fillStyle = rule.color;
    ctx.fillRect(rule.x, rule.y, rule.w, rule.h);
  }

  // The feed's avatar: the same artwork, cropped round. No second asset to keep in sync.
  if (placement.id === "feed") {
    ctx.save();
    ctx.beginPath();
    ctx.arc(FEED_AVATAR.x + FEED_AVATAR.size / 2, FEED_AVATAR.y + FEED_AVATAR.size / 2, FEED_AVATAR.size / 2, 0, Math.PI * 2);
    ctx.closePath();
    ctx.clip();
    drawFitted(ctx, artwork, { x: FEED_AVATAR.x, y: FEED_AVATAR.y, w: FEED_AVATAR.size, h: FEED_AVATAR.size }, "cover");
    ctx.restore();
    ctx.strokeStyle = PALETTE.amber;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(FEED_AVATAR.x + FEED_AVATAR.size / 2, FEED_AVATAR.y + FEED_AVATAR.size / 2, FEED_AVATAR.size / 2, 0, Math.PI * 2);
    ctx.stroke();
  }

  for (const layer of placement.layers) drawText(ctx, layer, copy);
}

export interface ComposeOptions {
  placement: Placement;
  artworkUrl: string;
  /** The person on their own, if the press kept the layers apart. */
  subjectUrl?: string;
  copy: PlacementCopy;
  /** The visitor's fit choice for this download; falls back to the placement's own default. */
  fit?: "cover" | "contain";
  /** The subject's own framing within the surface, as arranged on screen. */
  layer?: LayerTransform;
  /** Scale the export down (1 = spec pixels). Kept for a future "small download". */
  pixelRatio?: number;
}

export async function composePlacement({ placement, artworkUrl, subjectUrl, copy, fit, layer, pixelRatio = 1 }: ComposeOptions): Promise<Blob> {
  await readyFonts();
  const [artwork, ground, subject] = await Promise.all([
    loadImage(artworkUrl),
    loadGround(placement),
    subjectUrl ? loadImage(subjectUrl) : Promise.resolve(null),
  ]);
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(placement.width * pixelRatio);
  canvas.height = Math.round(placement.height * pixelRatio);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("this browser has no 2d canvas context");
  if (pixelRatio !== 1) ctx.scale(pixelRatio, pixelRatio);
  drawPlacement(ctx, placement, artwork, copy, ground, fit, layer, subject);
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
  if (!blob) throw new Error("the export failed");
  return blob;
}

/** Download a blob without leaking the object URL. */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

export const placementFilename = (placement: Placement, city: string): string =>
  `${city.toLowerCase().replaceAll(/\s+/g, "-")}-${placement.id}-${Date.now()}.png`;
