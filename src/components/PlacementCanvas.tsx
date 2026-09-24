import { useEffect, useRef } from "react";
import { drawPlacement, loadGround, loadImage, readyFonts, type LayerTransform } from "../world/compose";
import type { Placement, PlacementCopy } from "../world/placements";

/**
 * The preview, drawn by the exporter.
 *
 * Not a DOM mock-up of the placement — the same `drawPlacement()` the download uses, into a canvas
 * sized to the container. A preview built from CSS would be a second implementation of the same spec,
 * and the two would drift the first time a number moved. This cannot drift: what you see is the
 * function that writes the file.
 */

/**
 * Decoded images, kept. The press hands over the ground and the person as data URLs, and a drag repaints
 * the canvas on every pointer move; forking a fresh `Image` and decoding a megabyte of base64 on each of
 * those frames is what made an arrangment stutter — and stutter is what "the layering doesn't work" looks
 * like from the outside. One decode per URL, then it is pixels.
 */
const decoded = new Map<string, Promise<HTMLImageElement>>();

function decodeOnce(url: string): Promise<HTMLImageElement> {
  const cached = decoded.get(url);
  if (cached) return cached;
  const promise = loadImage(url).catch((error: unknown) => {
    // A URL that cannot be decoded must not poison the cache for a later, valid one.
    decoded.delete(url);
    throw error;
  });
  decoded.set(url, promise);
  return promise;
}

export interface PlacementCanvasProps {
  placement: Placement;
  artworkUrl: string;
  /** The person on their own, if the press kept the layers apart — the thing the layer controls move. */
  subjectUrl?: string;
  copy: PlacementCopy;
  /** The visitor's fit choice; falls back to the placement's own default. */
  fit?: "cover" | "contain";
  /** The subject's own framing within the surface — moved, sized, cut, or let run off the edge. */
  layer?: LayerTransform;
  className?: string;
}

export function PlacementCanvas({ placement, artworkUrl, subjectUrl, copy, fit, layer, className }: PlacementCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const { city, handle, title, line } = copy;

  useEffect(() => {
    let cancelled = false;
    // The repaint guard: the canvas's own size change fires the observer again, so a paint that
    // rescales the element would loop forever (and Playwright would never see a stable target).
    let lastWidth = 0;
    // The arrangement is part of the paint's identity: a drag has to repaint, and only a drag that changes
    // nothing should be skipped.
    let lastLayer: unknown = null;

    const paint = async () => {
      const canvas = canvasRef.current;
      const host = canvas?.parentElement;
      if (!canvas || !host) return;

      const cssWidth = Math.max(160, host.clientWidth);
      if (Math.abs(cssWidth - lastWidth) < 1 && lastLayer === layer) return;
      lastWidth = cssWidth;
      lastLayer = layer;

      const cssHeight = (cssWidth * placement.height) / placement.width;
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const targetW = Math.round(cssWidth * dpr);
      const targetH = Math.round(cssHeight * dpr);

      // One decode per URL, then pixels. A drag repaints on every pointer move, and forking a fresh Image
      // and decoding the ground and the person on each of those frames is what made arranging them stutter.
      await readyFonts();
      const [artwork, ground, subject] = await Promise.all([
        decodeOnce(artworkUrl),
        loadGround(placement),
        subjectUrl ? decodeOnce(subjectUrl) : Promise.resolve(null),
      ]);
      if (cancelled) return;

      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      // Only touch the backing store when it actually changes: assigning width or height clears the canvas
      // and reallocates it, which on every frame of a drag is a stutter of its own. When it does not change,
      // clearing by hand is enough — and it must be cleared, or a drag would paint over its own last frame.
      if (canvas.width !== targetW || canvas.height !== targetH) {
        canvas.width = targetW;
        canvas.height = targetH;
      } else {
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.clearRect(0, 0, targetW, targetH);
      }

      const scale = (cssWidth / placement.width) * dpr;
      ctx.setTransform(scale, 0, 0, scale, 0, 0);
      drawPlacement(ctx, placement, artwork, { city, handle, title, line }, ground, fit, layer, subject);
    };

    void paint().catch(() => undefined);
    const observer = new ResizeObserver(() => void paint().catch(() => undefined));
    if (canvasRef.current?.parentElement) observer.observe(canvasRef.current.parentElement);
    return () => {
      cancelled = true;
      observer.disconnect();
    };
  }, [placement, artworkUrl, subjectUrl, city, handle, title, line, fit, layer]);

  // Decorative: the composite is not interactive, and a canvas that swallows clicks would break the
  // button it sits inside. The aspect-ratio box is set up front so the layout never waits on the paint.
  return (
    <canvas
      ref={canvasRef}
      className={className}
      aria-hidden="true"
      style={{ pointerEvents: "none", width: "100%", aspectRatio: `${placement.width} / ${placement.height}`, display: "block" }}
    />
  );
}
