import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from "react";
import { PlacementCanvas } from "./PlacementCanvas";
import { LAYER_DEFAULT, cutAt, layerGeometry, loadImage, type LayerTransform } from "../world/compose";
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
 * And a **crop button**, because "I don't want the full body" is a decision about the picture, not a
 * percentage: pressing it turns the frame into a crop — the cut lines sit on the person where the cut will
 * land, you drag either one straight to where you want it, and the two sliders are the same two numbers for
 * anyone who would rather type. The lines are drawn on the *uncropped* extent, which is the part that is
 * otherwise invisible: the cut is applied to the source before the fit, so the person's drawn box is the
 * cropped one, and the only honest way to show what a crop is taking away is to draw the box it is taking it
 * from.
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
/** How much of the person a cut may take: the same ceiling the geometry itself enforces. */
const CROP_MAX = 0.6;

type Box = { x: number; y: number; w: number; h: number };

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
  const [cropping, setCropping] = useState(false);
  const [box, setBox] = useState<Box | null>(null);
  /** The person's box with nothing cut — the extent the crop is measured and drawn against. */
  const [whole, setWhole] = useState<Box | null>(null);
  const dragRef = useRef<{ x: number; y: number; dx: number; dy: number; w: number; h: number } | null>(null);
  const resizeRef = useRef<{ scale: number; cx: number; cy: number; from: number } | null>(null);
  const cropRef = useRef<{ edge: "top" | "bottom" } | null>(null);

  /** One writer for the layer, so a drag, a corner, a slider and a reset cannot disagree about the shape. */
  const updateLayer = (patch: Partial<LayerTransform>) => {
    setLayer((current) => ({ ...current, ...patch }));
  };

  useEffect(() => {
    if (!subjectUrl) {
      setBox(null);
      setWhole(null);
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
        // And the same call with the cuts lifted off, which is the box the crop is measured against.
        const none = layerGeometry(subject, FRAME.artwork, { ...layer, cropTop: 0, cropBottom: 0 }, fit);
        setWhole(none.destination);
      } catch {
        if (!cancelled) {
          setBox(null);
          setWhole(null);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [subjectUrl, fit, layer]);

  const startDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (resizeRef.current || cropRef.current) return;
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
    cropRef.current = null;
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

  /** A cut line: dragged straight to where the cut should land, in the frame's own units. */
  const startCrop = (edge: "top" | "bottom") => (event: ReactPointerEvent<HTMLSpanElement>) => {
    event.stopPropagation();
    cropRef.current = { edge };
    setDragging(true);
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const moveCrop = (event: ReactPointerEvent<HTMLSpanElement>) => {
    const crop = cropRef.current;
    if (!crop || !whole) return;
    event.stopPropagation();
    const host = event.currentTarget.closest('[data-testid="layer-surface"]');
    const rect = host?.getBoundingClientRect();
    if (!rect) return;
    const pointerY = ((event.clientY - rect.top) / rect.height) * FRAME.height;
    const next = cutAt(pointerY, whole, crop.edge);
    updateLayer(crop.edge === "top" ? { cropTop: next } : { cropBottom: next });
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

  /**
   * The crop, as four numbers that are always inside the frame.
   *
   * The lines are drawn on the *uncropped* box, and that box can extend past the frame — a person dragged
   * towards the top, or one whose head is taller than the artwork rect. Untreated, the top line then sits
   * outside the surface where nothing can grab it, which is how it was found: a probe of the running app
   * measured the line at y=263 with the surface starting at y=270. So the drawn position is held inside,
   * while the *mapping* keeps using the true box — the pointer decides the cut, the line only shows it.
   */
  const LINE_INSET = 20;
  const clampIntoFrame = (value: number) => Math.min(FRAME.height, Math.max(0, value));
  const handleY = (value: number) =>
    Math.min(FRAME.height - LINE_INSET, Math.max(LINE_INSET, value));
  const topLineY = whole ? handleY(whole.y + whole.h * layer.cropTop) : 0;
  const bottomLineY = whole ? handleY(whole.y + whole.h * (1 - layer.cropBottom)) : 0;
  const topShade = whole
    ? (() => {
        const from = clampIntoFrame(whole.y);
        const to = clampIntoFrame(whole.y + whole.h * layer.cropTop);
        return { y: from, h: Math.max(0, to - from) };
      })()
    : null;
  const bottomShade = whole
    ? (() => {
        const from = clampIntoFrame(whole.y + whole.h * (1 - layer.cropBottom));
        const to = clampIntoFrame(whole.y + whole.h);
        return { y: from, h: Math.max(0, to - from) };
      })()
    : null;
  const cutSummary =
    layer.cropTop > 0 || layer.cropBottom > 0
      ? ` · ${Math.round(layer.cropTop * 100)}% off the top, ${Math.round(layer.cropBottom * 100)}% off the foot`
      : "";

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
            aria-label={
              cropping
                ? "cropping: drag the cut line to where the cut should land, or use the sliders"
                : "the subject in the frame: drag it, drag a corner to size it, or nudge with the arrow keys"
            }
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

            {/* The crop, shown on the uncropped extent: what is being taken away, and the line it is taken on. */}
            {cropping && whole && box ? (
              <div data-testid="crop-layer" aria-hidden="true" className="pointer-events-none absolute inset-0">
                {(
                  [
                    ["top", topShade?.y ?? 0, topShade?.h ?? 0],
                    ["bottom", bottomShade?.y ?? 0, bottomShade?.h ?? 0],
                  ] as const
                ).map(([edge, y, h]) =>
                  h > 0.5 ? (
                    <div
                      key={`shade-${edge}`}
                      data-testid={`crop-shade-${edge}`}
                      style={{
                        position: "absolute",
                        left: percent(whole.x, FRAME.width),
                        top: percent(y, FRAME.height),
                        width: percent(whole.w, FRAME.width),
                        height: percent(h, FRAME.height),
                        background: "rgba(6, 6, 12, 0.62)",
                      }}
                    />
                  ) : null,
                )}
                {(
                  [
                    ["top", topLineY],
                    ["bottom", bottomLineY],
                  ] as const
                ).map(([edge, y]) => (
                  <span
                    key={`line-${edge}`}
                    data-testid={`crop-handle-${edge}`}
                    onPointerDown={startCrop(edge)}
                    onPointerMove={moveCrop}
                    onPointerUp={endDrag}
                    onPointerCancel={endDrag}
                    style={{
                      position: "absolute",
                      left: percent(whole.x, FRAME.width),
                      top: percent(y, FRAME.height),
                      width: percent(whole.w, FRAME.width),
                      height: 22,
                      transform: "translateY(-50%)",
                      pointerEvents: "auto",
                      cursor: "ns-resize",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                  >
                    <span
                      style={{
                        width: "100%",
                        height: 3,
                        background: "var(--color-accent)",
                        boxShadow: "0 0 0 1px rgba(6, 6, 12, 0.65)",
                      }}
                    />
                  </span>
                ))}
              </div>
            ) : null}
          </div>
          <p className="mt-3 text-xs" style={{ color: "var(--color-faint)" }}>
            {FRAME.width}×{FRAME.height} · the dashed box is them — drag it to move, drag a corner to size it
            {cropping ? ", drag a cut line to take the top or the foot off" : ""}
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
              {cropping ? (
                <>
                  <label className="block text-xs" style={{ color: "var(--color-muted)" }}>
                    cut from the top · {Math.round(layer.cropTop * 100)}%
                    <input
                      data-testid="layer-crop-top"
                      type="range"
                      min={0}
                      max={CROP_MAX}
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
                      max={CROP_MAX}
                      step={0.01}
                      value={layer.cropBottom}
                      onChange={(event) => updateLayer({ cropBottom: Number(event.target.value) })}
                      className="mt-2 w-full"
                    />
                  </label>
                </>
              ) : null}
            </div>
            <div className="mt-4 flex flex-wrap gap-3">
              <button
                type="button"
                role="switch"
                aria-checked={cropping}
                data-testid="arrange-crop"
                onClick={() => setCropping((on) => !on)}
                className={cropping ? "btn" : "btn-quiet"}
              >
                {cropping ? "done cropping" : `crop${cutSummary}`}
              </button>
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
            {cropping ? (
              <p className="measure mt-3 text-xs" style={{ color: "var(--color-faint)" }}>
                the cut lines are the crop: drag either one straight to where you want it, or take the sliders
                above. the shaded bands are what the cut is removing, and the person is refitted to what is
                left — so taking the foot off fills the frame with the rest of you.
              </p>
            ) : null}
          </div>
        </aside>
      </div>
    </div>
  );
}