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
  fillCopy,
  type Placement,
  type PlacementCopy,
  type TextLayer,
} from "./placements";

/** Fonts must be resident before canvas text, or the export falls back to a system face. */
export async function readyFonts(): Promise<void> {
  if (typeof document === "undefined" || !document.fonts) return;
  await Promise.all([
    document.fonts.load('400 32px "Limelight"'),
    document.fonts.load('400 32px "Poiret One"'),
    document.fonts.load('400 32px "Pinyon Script"'),
    document.fonts.load('400 32px "Inter"'),
    document.fonts.load('600 32px "Inter"'),
    document.fonts.ready,
  ]);
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

/** Cover crop: fill the rect, keep the aspect, centre the overflow. */
function drawCover(
  ctx: CanvasRenderingContext2D,
  image: HTMLImageElement,
  rect: { x: number; y: number; w: number; h: number },
): void {
  const scale = Math.max(rect.w / image.width, rect.h / image.height);
  const w = image.width * scale;
  const h = image.height * scale;
  ctx.drawImage(image, rect.x + (rect.w - w) / 2, rect.y + (rect.h - h) / 2, w, h);
}

function drawContain(
  ctx: CanvasRenderingContext2D,
  image: HTMLImageElement,
  rect: { x: number; y: number; w: number; h: number },
): void {
  const scale = Math.min(rect.w / image.width, rect.h / image.height);
  const w = image.width * scale;
  const h = image.height * scale;
  ctx.drawImage(image, rect.x + (rect.w - w) / 2, rect.y + (rect.h - h) / 2, w, h);
}

function gradient(ctx: CanvasRenderingContext2D, placement: Placement, w: number, h: number): void {
  // The 189° panel gradient from DESIGN.md, drawn as a linear ramp across the canvas diagonal.
  const angle = (placement.ground.angle * Math.PI) / 180;
  const dx = Math.cos(angle) * w;
  const dy = Math.sin(angle) * h;
  const fill = ctx.createLinearGradient(0, 0, dx, dy);
  fill.addColorStop(0, placement.ground.stops[0]);
  fill.addColorStop(1, placement.ground.stops[1]);
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
): void {
  const { width, height } = placement;
  gradient(ctx, placement, width, height);

  if (placement.bezel) {
    ctx.fillStyle = placement.bezel.color;
    ctx.fillRect(placement.bezel.x, placement.bezel.y, placement.bezel.w, placement.bezel.h);
  }

  if (placement.artwork.fit === "cover") drawCover(ctx, artwork, placement.artwork);
  else drawContain(ctx, artwork, placement.artwork);

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
    drawCover(ctx, artwork, { x: FEED_AVATAR.x, y: FEED_AVATAR.y, w: FEED_AVATAR.size, h: FEED_AVATAR.size });
    ctx.restore();
    ctx.strokeStyle = "#fcaf17";
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
  /** Scale the export down (1 = spec pixels). Kept for a future "small download". */
  pixelRatio?: number;
}

export async function composePlacement({ placement, artworkUrl, copy, pixelRatio = 1 }: ComposeOptions): Promise<Blob> {
  await readyFonts();
  const artwork = await loadImage(artworkUrl);
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(placement.width * pixelRatio);
  canvas.height = Math.round(placement.height * pixelRatio);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("this browser has no 2d canvas context");
  if (pixelRatio !== 1) ctx.scale(pixelRatio, pixelRatio);
  drawPlacement(ctx, placement, artwork, copy);
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
