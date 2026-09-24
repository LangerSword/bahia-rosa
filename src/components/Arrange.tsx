import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from "react";
import { PlacementCanvas } from "./PlacementCanvas";
import { LAYER_DEFAULT, layerGeometry, loadImage, type LayerTransform } from "../world/compose";
import { FRAME, type PlacementCopy } from "../world/placements";
import type { Fit } from "../lib/payoff";

/**
 * Placing them in the frame — the one thing the press cannot decide for you.
 *
 * It belongs to the phase where the picture is made, not to the downloading stage: an arrangement judged
 * inside a billboard's 8:3 mount and again inside a venue card's 3:4 looks different in each, and "it was
 * right in one of them" is not an arrangement. So it sits inside the editor's own shell, and the city
 * receives a decision already made.
 *
 * The subject has an **outline**: their actual box in the frame, with a handle at each corner. Without it an
 * arrangement is invisible — you drag and something moves, but nothing says what is being moved or how big
 * it currently is. With it, the box *is* the control: drag anywhere to move, drag a corner to resize.
 *
 * The outline is drawn from `layerGeometry` — the same function, with the same arguments, that the exporter
 * draws the person with. A second opinion about the geometry would drift away from the person the moment
 * either side changed. (Unlayer's editor edits one flat picture and cannot hold a movable object, so the
 * frame is the panel immediately above the tools rather than inside the canvas.)
 */
export interface ArrangeProps {
  /** The place, with nobody in it. */
  artworkUrl: string;
  /** The person on their own — what the box moves and sizes. */
  subjectUrl?: string;
  copy: PlacementCopy;
  fit: Fit;
  layer: LayerTransform;
  setLayer: (next: LayerTransform | ((current: LayerTransform) => LayerTransform)) => void;
  /**
   * Leave for the city without editing. The arrangement is a decision about the picture, and a visitor who
   * has made it should not have to save something out of the editor to reach the four downloads — that
   * would flatten the layers and drop the arrangement they just made.
   */
  onToCity?: () => void;
}

/** One decode per URL, kept: the outline is recomputed on every layer change, including every drag frame. */
const decoded = new Map<string, Promise<HTMLImageElement>>();

function decodeOnce(src: string): Promise<HTMLImageElement> {
  const held = decoded.get(src);
  if (held) return held;
  const pending = loadImage(src);
  decoded.set(src, pending);
  return pending;
}

const clampMove = (value: number) => Math.min(1.5, Math.max(-1.5, value));
const clampScale = (value: number) => Math.min(2.4, Math.max(0.4, value));

export function Arrange({
  artworkUrl,
  subjectUrl,
  copy,
  fit,
  layer,
  setLayer,
  onToCity,
}: ArrangeProps) {
  const [dragging, setDragging] = useState(false);
  const [box, setBox] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const dragRef = useRef<{ x: number; y: number; dx: number; dy: number; w: number; h: number } | null>(null);
  const resizeRef = useRef<{ scale: number; cx: number; cy: number; from: number } | null>(null);

  /** One writer for the layer, so a drag, a corner, a slider and a reset cannot disagree about the shape. */
  const updateLayer = (patch: Partial<LayerTransform>) => {
    setLayer((current) => ({ ...current, ...patch }));
  };

  useEffect(() => {
    if (!subjectUrl) {
      setBox(null);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const subject = await decodeOnce(subjectUrl);
        if (cancelled) return;
        // Exactly what `drawLayer` is handed: the person, the placement's artwork rect, the arrangement.
        const { destination } = layerGeometry(subject, FRAME.artwork, layer, fit);
        setBox(destination);
      } catch {
        if (!cancelled) setBox(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [subjectUrl, fit, layer]);

  const startDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (resizeRef.current) return;
    const rect = event.currentTarget.getBoundingClientRect();
    dragRef.current = {
      x: event.clientX,
      y: event.clientY,
      dx: layer.dx,
      dy: layer.dy,
      w: Math.max(1, rect.width),
      h: Math.max(1, rect.height),
    };
    setDragging(true);
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const moveDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag) return;
    // A drag is a fraction of the surface, so the same gesture means the same thing on a plate and on a
    // billboard — and a download at 1600px wide reproduces it exactly.
    updateLayer({
      dx: clampMove(drag.dx + (event.clientX - drag.x) / drag.w),
      dy: clampMove(drag.dy + (event.clientY - drag.y) / drag.h),
    });
  };

  const endDrag = (event: ReactPointerEvent<HTMLDivElement | HTMLSpanElement>) => {
    dragRef.current = null;
    resizeRef.current = null;
    setDragging(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  /** A corner: the size follows the distance from the box's own centre, so it scales about its centre. */
  const startResize = (event: ReactPointerEvent<HTMLSpanElement>) => {
    event.stopPropagation();
    const host = event.currentTarget.closest('[data-testid="layer-surface"]');
    const rect = host?.getBoundingClientRect();
    if (!rect || !box) return;
    const cx = rect.left + ((box.x + box.w / 2) / FRAME.width) * rect.width;
    const cy = rect.top + ((box.y + box.h / 2) / FRAME.height) * rect.height;
    resizeRef.current = {
      scale: layer.scale,
      cx,
      cy,
      from: Math.max(8, Math.hypot(event.clientX - cx, event.clientY - cy)),
    };
    setDragging(true);
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const moveResize = (event: ReactPointerEvent<HTMLSpanElement>) => {
    const resize = resizeRef.current;
    if (!resize) return;
    event.stopPropagation();
    const now = Math.max(8, Math.hypot(event.clientX - resize.cx, event.clientY - resize.cy));
    updateLayer({ scale: clampScale((resize.scale * now) / resize.from) });
  };

  /** The same movement without a pointer: arrows nudge, shift-arrows move by a bigger step. */
  const nudge = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const step = event.shiftKey ? 0.1 : 0.02;
    const moves: Record<string, [number, number]> = {
      ArrowLeft: [-step, 0],
      ArrowRight: [step, 0],
      ArrowUp: [0, -step],
      ArrowDown: [0, step],
    };
    const move = moves[event.key];
    if (!move) return;
    event.preventDefault();
    updateLayer({ dx: clampMove(layer.dx + move[0]), dy: clampMove(layer.dy + move[1]) });
  };

  const offCentre =
    layer.dx !== 0 || layer.dy !== 0 || layer.scale !== 1 || layer.cropTop !== 0 || layer.cropBottom !== 0;

  const percent = (value: number, total: number) => `${(value / total) * 100}%`;

  return (
    <div data-testid="arrange" aria-labelledby="arrange-heading">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h3 id="arrange-heading" className="kicker" style={{ color: "var(--color-paper)" }}>
          the frame
        </h3>
        <p className="text-xs" style={{ color: "var(--color-muted)" }}>
          {offCentre
            ? "the city will print this arrangement — every surface, and the downloads"
            : "where they stand · the city prints whatever you decide here"}
        </p>
      </div>

      <div className="mt-4 grid gap-6 lg:grid-cols-[1fr_minmax(240px,300px)]">
        <div>
          <div
            className="plate-inset relative"
            data-testid="layer-surface"
            role="application"
            tabIndex={0}
            aria-label="the subject in the frame: drag it, drag a corner to size it, or nudge with the arrow keys"
            onPointerDown={startDrag}
            onPointerMove={moveDrag}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
            onKeyDown={nudge}
            style={{ touchAction: "none", cursor: dragging ? "grabbing" : "grab" }}
          >
            <PlacementCanvas
              placement={FRAME}
              artworkUrl={artworkUrl}
              subjectUrl={subjectUrl}
              copy={copy}
              fit={fit}
              layer={layer}
              className="block w-full"
            />

            {/* The box they occupy, from the exporter's own geometry, with the corners that size them. */}
            {box ? (
              <div
                data-testid="layer-outline"
                aria-hidden="true"
                className="pointer-events-none absolute"
                style={{
                  left: percent(box.x, FRAME.width),
                  top: percent(box.y, FRAME.height),
                  width: percent(box.w, FRAME.width),
                  height: percent(box.h, FRAME.height),
                  border: "1px dashed color-mix(in srgb, var(--color-accent) 75%, transparent)",
                }}
              >
                {(["nw", "ne", "sw", "se"] as const).map((corner) => (
                  <span
                    key={corner}
                    data-testid={`layer-handle-${corner}`}
                    onPointerDown={startResize}
                    onPointerMove={moveResize}
                    onPointerUp={endDrag}
                    onPointerCancel={endDrag}
                    style={{
                      position: "absolute",
                      width: 14,
                      height: 14,
                      background: "var(--color-accent)",
                      border: "1px solid var(--color-ink)",
                      borderRadius: 2,
                      pointerEvents: "auto",
                      cursor: `${corner}-resize`,
                      ...(corner.includes("n") ? { top: -7 } : { bottom: -7 }),
                      ...(corner.includes("w") ? { left: -7 } : { right: -7 }),
                    }}
                  />
                ))}
              </div>
            ) : null}
          </div>
          <p className="mt-3 text-xs" style={{ color: "var(--color-faint)" }}>
            {FRAME.width}×{FRAME.height} · the dashed box is them — drag it to move, drag a corner to size it
          </p>
          {onToCity ? (
            <div className="mt-4 flex flex-wrap items-center gap-3">
              <button type="button" data-testid="arrange-to-city" onClick={onToCity} className="btn">
                Take it into the city
              </button>
              <span className="text-xs" style={{ color: "var(--color-faint)" }}>
                the four surfaces and the downloads · the editor below is optional
              </span>
            </div>
          ) : null}
        </div>

        <aside className="flex flex-col gap-6">
          <div>
            <h4 className="text-xs" style={{ color: "var(--color-muted)" }}>
              the person
            </h4>
            <p className="measure mt-2 text-xs" style={{ color: "var(--color-faint)" }}>
              one arrangement, applied to all four surfaces and to the downloads — however many of you are in
              the photograph, since a group is painted as one and moves, sizes and cuts as one.
            </p>
            <div className="mt-4 grid gap-4 sm:grid-cols-3">
              <label className="block text-xs" style={{ color: "var(--color-muted)" }}>
                size · {layer.scale.toFixed(2)}×
                <input
                  data-testid="layer-scale"
                  type="range"
                  min={0.4}
                  max={2.4}
                  step={0.02}
                  value={layer.scale}
                  onChange={(event) => updateLayer({ scale: Number(event.target.value) })}
                  className="mt-2 w-full"
                />
              </label>
              <label className="block text-xs" style={{ color: "var(--color-muted)" }}>
                cut from the top · {Math.round(layer.cropTop * 100)}%
                <input
                  data-testid="layer-crop-top"
                  type="range"
                  min={0}
                  max={0.6}
                  step={0.01}
                  value={layer.cropTop}
                  onChange={(event) => updateLayer({ cropTop: Number(event.target.value) })}
                  className="mt-2 w-full"
                />
              </label>
              <label className="block text-xs" style={{ color: "var(--color-muted)" }}>
                cut from the bottom · {Math.round(layer.cropBottom * 100)}%
                <input
                  data-testid="layer-crop-bottom"
                  type="range"
                  min={0}
                  max={0.6}
                  step={0.01}
                  value={layer.cropBottom}
                  onChange={(event) => updateLayer({ cropBottom: Number(event.target.value) })}
                  className="mt-2 w-full"
                />
              </label>
            </div>
            <div className="mt-4 flex flex-wrap gap-3">
              <button
                type="button"
                role="switch"
                aria-checked={layer.overflow}
                data-testid="layer-overflow"
                onClick={() => updateLayer({ overflow: !layer.overflow })}
                className="btn-quiet"
              >
                {layer.overflow ? "runs off the edge" : "held inside the frame"}
              </button>
              <button
                type="button"
                data-testid="layer-reset"
                onClick={() => setLayer(LAYER_DEFAULT)}
                className="btn-quiet"
              >
                reset the layer
              </button>
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}