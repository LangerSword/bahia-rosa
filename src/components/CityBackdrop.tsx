import { useEffect, useRef } from "react";
import { drawBackdrop, type BackdropId } from "../look/backdrops";

/**
 * The city behind everything.
 *
 * A canvas that repaints itself: clouds drift, water shimmers, a window flickers. It is redrawn at a
 * capped rate (not every frame) because a background is not worth a phone's battery, and held still
 * entirely when the visitor has asked for reduced motion — the scene is decoration, and decoration
 * does not get to override that setting.
 */
export function CityBackdrop({
  id,
  className,
  seed = 7,
  fps = 20,
}: {
  id: BackdropId;
  className?: string;
  seed?: number;
  fps?: number;
}) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const still = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    const interval = 1000 / Math.max(1, fps);
    const started = performance.now();
    let raf = 0;
    let last = -Infinity;

    const paint = (now: number): void => {
      if (now - last >= interval) {
        last = now;
        const dpr = Math.min(2, window.devicePixelRatio || 1);
        const rect = canvas.getBoundingClientRect();
        const width = Math.max(320, Math.round(rect.width));
        const height = Math.max(180, Math.round(rect.height));
        if (canvas.width !== Math.round(width * dpr) || canvas.height !== Math.round(height * dpr)) {
          canvas.width = Math.round(width * dpr);
          canvas.height = Math.round(height * dpr);
        }
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        drawBackdrop(ctx, width, height, id, still ? 0 : (now - started) / 1000, seed);
      }
      if (!still) raf = requestAnimationFrame(paint);
    };

    paint(performance.now());
    return () => cancelAnimationFrame(raf);
  }, [id, seed, fps]);

  return <canvas ref={ref} className={className} aria-hidden="true" />;
}