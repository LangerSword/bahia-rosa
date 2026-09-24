import { useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from "react";
import { PlacementCanvas } from "./PlacementCanvas";
import { LAYER_DEFAULT, type LayerTransform } from "../world/compose";
import { FRAME, type PlacementCopy } from "../world/placements";
import type { Fit } from "../lib/payoff";

/**
 * Placing them in the frame — the one thing the press cannot decide for you.
 *
 * This surface used to live in the city, beside the four things you download, and that was the wrong place:
 * an arrangement is a decision about the *picture*, and the city's job is to print it. Judging it in a
 * billboard's 8:3 mount and again in a venue card's 3:4 is how "it looked right there" happens. It belongs
 * to the phase where the picture is made — so it sits with the editor, above the editor, and what the city
 * receives is a decision that has already been made.
 *
 * One arrangement, applied to every surface and to the downloads, because there is one picture. However many
 * people are in it: a group is painted as one and moves, sizes and cuts as one — splitting a group would
 * break the paint's continuity, and the shared light and shared palette are the reason the frame reads as a
 * photograph rather than as cut-outs on a backdrop.
 */
export interface ArrangeProps {
  /** The place, with nobody in it. */
  artworkUrl: string;
  /** The person on their own — what the drag moves. */
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
  const dragRef = useRef<{ x: number; y: number; dx: number; dy: number; w: number; h: number } | null>(null);

  /** One writer for the layer, so a drag, a slider and a reset cannot disagree about the shape. */
  const updateLayer = (patch: Partial<LayerTransform>) => {
    setLayer((current) => ({ ...current, ...patch }));
  };

  const clampMove = (value: number) => Math.min(1.5, Math.max(-1.5, value));

  const startDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
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

  const endDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    dragRef.current = null;
    setDragging(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
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

  const offCentre = layer.dx !== 0 || layer.dy !== 0 || layer.scale !== 1 || layer.cropTop !== 0 || layer.cropBottom !== 0;

  return (
    <section className="section" data-testid="arrange" aria-labelledby="arrange-heading">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h2 id="arrange-heading" className="display" style={{ color: "var(--color-paper)" }}>
            <span style={{ color: "var(--color-faint)" }}>~ </span>place them
          </h2>
          <p className="measure mt-2 text-xs" style={{ color: "var(--color-muted)" }}>
            {offCentre
              ? "the city will print this arrangement — every surface, and the downloads"
              : "where they stand in the picture · the city prints whatever you decide here"}
          </p>
        </div>
      </div>

      <div className="mt-6 grid gap-8 lg:grid-cols-[1fr_minmax(260px,320px)]">
        <div>
          <div
            className="plate-inset"
            data-testid="layer-surface"
            role="application"
            tabIndex={0}
            aria-label="the subject in the frame: drag it, or nudge it with the arrow keys"
            onPointerDown={startDrag}
            onPointerMove={moveDrag}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
            onKeyDown={nudge}
            style={{
              touchAction: "none",
              cursor: dragging ? "grabbing" : "grab",
              outline: dragging ? "none" : undefined,
            }}
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
          </div>
          <p className="mt-3 text-xs" style={{ color: "var(--color-faint)" }}>
            {FRAME.width}×{FRAME.height} · drag them, or nudge with the arrow keys
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

        <aside className="flex flex-col gap-8">
          <div>
            <h3 className="text-xs" style={{ color: "var(--color-muted)" }}>
              the person
            </h3>
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

          <p className="measure text-xs" style={{ color: "var(--color-faint)" }}>
            the editor below works on the picture itself. save an edit from it and the frame is flattened into
            one image — so arrange first if you are going to do both.
          </p>
        </aside>
      </div>
    </section>
  );
}