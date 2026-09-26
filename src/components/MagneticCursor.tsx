import { useEffect, useRef, useState, type ReactElement } from "react";
import { magnetPull, type Magnet } from "../lib/magnet";
import "./cursor.css";

/**
 * The ring.
 *
 * A companion to the pointer, not a replacement for it: it eases toward where the visitor is pointing and
 * leans toward the nearest thing that has asked to be magnetic (`[data-magnet]`). It is decoration on top of
 * normal input — the real cursor still exists, still clicks, and nothing here intercepts a pointer event.
 *
 * It only exists where it means something: a device with a fine pointer, and a visitor who has not asked for
 * less motion. The per-frame work is one transform write plus a handful of rect reads; no React state runs at
 * frame rate. On touch devices, or reduced motion, the component renders nothing at all.
 */
export function MagneticCursor(): ReactElement | null {
  const ring = useRef<HTMLDivElement>(null);
  const [enabled, setEnabled] = useState(false);

  useEffect(() => {
    if (typeof window.matchMedia !== "function") return undefined;
    const fine = window.matchMedia("(pointer: fine)");
    const calm = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = (): void => setEnabled(fine.matches && !calm.matches);
    update();
    fine.addEventListener("change", update);
    calm.addEventListener("change", update);
    return () => {
      fine.removeEventListener("change", update);
      calm.removeEventListener("change", update);
    };
  }, []);

  useEffect(() => {
    if (!enabled) return undefined;
    const node = ring.current;
    if (!node) return undefined;

    const pointer = { x: -100, y: -100, seen: false, movedAt: 0 };
    const at = { x: -100, y: -100 };
    let frame = 0;

    const onMove = (event: PointerEvent): void => {
      pointer.x = event.clientX;
      pointer.y = event.clientY;
      pointer.seen = true;
      pointer.movedAt = performance.now();
    };
    const onLeave = (): void => {
      pointer.seen = false;
    };

    const magnetsNow = (): Magnet[] => {
      // Everything that asks to be magnetic explicitly, plus the site's own primary controls — the hero's
      // door, the finish control, the forks. Asking every button to carry a data attribute would mean a
      // magnet that exists only where someone remembered to write one.
      const nodes = document.querySelectorAll<HTMLElement>("[data-magnet], .btn, .btn-quiet");
      const found: Magnet[] = [];
      nodes.forEach((element) => {
        const rect = element.getBoundingClientRect();
        if (rect.width === 0 && rect.height === 0) return;
        found.push({
          id: element.dataset.magnet || element.className.split(" ")[0] || "magnet",
          rect: { left: rect.left, top: rect.top, width: rect.width, height: rect.height },
        });
      });
      return found;
    };

    const tick = (): void => {
      frame = requestAnimationFrame(tick);
      // A ring that stays parked where the pointer last was, while the visitor reads, is litter. After two
      // and a half seconds of stillness it fades; the next movement brings it back.
      const resting = performance.now() - pointer.movedAt > 2500;
      if (!pointer.seen || resting) {
        node.dataset.visible = "no";
        return;
      }
      const pull = magnetPull(pointer.x, pointer.y, magnetsNow());
      const targetX = pointer.x + pull.dx;
      const targetY = pointer.y + pull.dy;
      // A plain ease, so the ring trails the pointer slightly instead of being welded to it.
      at.x += (targetX - at.x) * 0.2;
      at.y += (targetY - at.y) * 0.2;
      node.style.transform = `translate3d(${at.x.toFixed(2)}px, ${at.y.toFixed(2)}px, 0)`;
      node.dataset.visible = "yes";
      node.dataset.pulled = pull.strength > 0.08 ? "yes" : "no";
    };

    window.addEventListener("pointermove", onMove, { passive: true });
    // `pointerout` bubbles from every element the pointer crosses, which would mark it gone on every mouse
    // move; `pointerleave` does not bubble, so on the window it means the one thing we want — the pointer
    // left the page.
    window.addEventListener("pointerleave", onLeave);
    window.addEventListener("blur", onLeave);
    frame = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerleave", onLeave);
      window.removeEventListener("blur", onLeave);
    };
  }, [enabled]);

  if (!enabled) return null;

  return <div ref={ring} className="magnet-ring" data-testid="magnet-ring" aria-hidden="true" />;
}