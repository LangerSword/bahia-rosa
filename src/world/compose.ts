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
export function drawPlacement(
  ctx: CanvasRenderingContext2D,
  placement: Placement,
  artwork: HTMLImageElement,
  copy: PlacementCopy,
  ground: HTMLImageElement | null = null,
  /** Overrides the placement's own default — the visitor's choice, for this download. */
  fitOverride?: "cover" | "contain",
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

  drawFitted(ctx, artwork, placement.artwork, fit);

  if (fit === "contain") {
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
  copy: PlacementCopy;
  /** The visitor's fit choice for this download; falls back to the placement's own default. */
  fit?: "cover" | "contain";
  /** Scale the export down (1 = spec pixels). Kept for a future "small download". */
  pixelRatio?: number;
}

export async function composePlacement({ placement, artworkUrl, copy, fit, pixelRatio = 1 }: ComposeOptions): Promise<Blob> {
  await readyFonts();
  const [artwork, ground] = await Promise.all([loadImage(artworkUrl), loadGround(placement)]);
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(placement.width * pixelRatio);
  canvas.height = Math.round(placement.height * pixelRatio);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("this browser has no 2d canvas context");
  if (pixelRatio !== 1) ctx.scale(pixelRatio, pixelRatio);
  drawPlacement(ctx, placement, artwork, copy, ground, fit);
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
