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

export interface PlacementCanvasProps {
  placement: Placement;
  artworkUrl: string;
  copy: PlacementCopy;
  /** The visitor's fit choice; falls back to the placement's own default. */
  fit?: "cover" | "contain";
  /** The subject's own framing within the surface — moved, sized, cut, or let run off the edge. */
  layer?: LayerTransform;
  className?: string;
}

export function PlacementCanvas({ placement, artworkUrl, copy, fit, layer, className }: PlacementCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const { city, handle, title, line } = copy;

  useEffect(() => {
    let cancelled = false;
    // The repaint guard: the canvas's own size change fires the observer again, so a paint that
    // rescales the element would loop forever (and Playwright would never see a stable target).
    let lastWidth = 0;

    const paint = async () => {
      const canvas = canvasRef.current;
      const host = canvas?.parentElement;
      if (!canvas || !host) return;

      const cssWidth = Math.max(160, host.clientWidth);
      if (Math.abs(cssWidth - lastWidth) < 1) return;
      lastWidth = cssWidth;

      const cssHeight = (cssWidth * placement.height) / placement.width;
      const dpr = Math.min(2, window.devicePixelRatio || 1);

      await readyFonts();
      const [artwork, ground] = await Promise.all([loadImage(artworkUrl), loadGround(placement)]);
      if (cancelled) return;

      canvas.width = Math.round(cssWidth * dpr);
      canvas.height = Math.round(cssHeight * dpr);
      // Deliberately NOT setting style.width/height: the JSX already reserves the exact box with
      // aspect-ratio, so the async paint changes the backing store and never the layout. Resizing the
      // element here is what made the surrounding buttons "not stable" for a click.

      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      const scale = (cssWidth / placement.width) * dpr;
      ctx.setTransform(scale, 0, 0, scale, 0, 0);
      drawPlacement(ctx, placement, artwork, { city, handle, title, line }, ground, fit, layer);
    };

    void paint().catch(() => undefined);
    const observer = new ResizeObserver(() => void paint().catch(() => undefined));
    if (canvasRef.current?.parentElement) observer.observe(canvasRef.current.parentElement);
    return () => {
      cancelled = true;
      observer.disconnect();
    };
  }, [placement, artworkUrl, city, handle, title, line, fit, layer]);

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
