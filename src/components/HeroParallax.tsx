import { useEffect, useRef, type ReactElement, type ReactNode } from "react";
import { useReducedMotion } from "motion/react";
import "./hero-parallax.css";

/**
 * The hero as a camera, not a poster.
 *
 * The trailer's city never holds still — it drifts, it breathes, the light walks across it. In a browser the
 * honest version of that is depth: the hero's layers move by different amounts under the pointer, and the
 * scene itself breathes on a long loop, the way a locked-off shot still has air moving in it. Three CSS
 * variables on one wrapper, written on the frame and read by CSS — the same device the step rail and the
 * vapour use, for the same reason: the animation costs a style write, not a re-render.
 *
 * Nothing here is load-bearing. With reduced motion on it writes nothing and the CSS zeroes the depths, so
 * the hero is exactly what it was. A thumb is not a camera: touch pointers are ignored.
 */
export function HeroParallax({ children }: { children: ReactNode }): ReactElement {
  const reduce = useReducedMotion();
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el || reduce) return;
    let raf = 0;
    let queued = false;
    let px = 0;
    let py = 0;

    const write = (): void => {
      queued = false;
      el.style.setProperty("--hx", px.toFixed(3));
      el.style.setProperty("--hy", py.toFixed(3));
    };

    const schedule = (): void => {
      if (queued) return;
      queued = true;
      raf = requestAnimationFrame(write);
    };

    const onMove = (event: PointerEvent): void => {
      if (event.pointerType !== "mouse") return;
      const box = el.getBoundingClientRect();
      if (box.width === 0 || box.height === 0) return;
      px = Math.max(-1, Math.min(1, ((event.clientX - box.left) / box.width) * 2 - 1));
      py = Math.max(-1, Math.min(1, ((event.clientY - box.top) / box.height) * 2 - 1));
      schedule();
    };

    const settle = (): void => {
      px = 0;
      py = 0;
      schedule();
    };

    el.addEventListener("pointermove", onMove);
    el.addEventListener("pointerleave", settle);
    return () => {
      cancelAnimationFrame(raf);
      el.removeEventListener("pointermove", onMove);
      el.removeEventListener("pointerleave", settle);
    };
  }, [reduce]);

  return (
    <div ref={ref} className="hero-parallax" data-parallax={reduce ? "off" : "on"}>
      {children}
    </div>
  );
}