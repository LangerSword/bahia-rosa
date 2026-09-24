import { useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from "react";
import { PlacementCanvas } from "./PlacementCanvas";
import { LAYER_DEFAULT, composePlacement, downloadBlob, placementFilename, type LayerTransform } from "../world/compose";
import { PLACEMENTS, type Placement, type PlacementCopy } from "../world/placements";

/**
 * The payoff — the part of the product that justifies the editor.
 *
 * Three things changed here, all of them from the brief:
 *
 *   1. **The details are kept.** The copy you type (handle, headline, caption) and the surface you last
 *      chose are remembered in this browser, so leaving to crop something and coming back — or closing
 *      the tab and returning — does not throw your words away. Nothing is uploaded: it is
 *      `localStorage`, on your machine, like everything else on this page.
 *   2. **It is not a separate stage.** There is no "step 3" anymore. The city is a surface you can
 *      reach straight from the fork, without going through the editor at all, and it sits in the page
 *      rather than behind a section of its own.
 *   3. **It fits the design.** The copy is set in the page's own voice, and the heading describes what
 *      you are looking at instead of announcing a stage.
 *
 * Every preview is drawn by the exporter (`PlacementCanvas` → `drawPlacement`), so a download *is* the
 * preview at full resolution, not a second rendering of it.
 */

export interface LaunchProps {
  artworkUrl: string;
  /** The person on their own, if the press kept the layers apart — what the layer controls move. */
  subjectUrl?: string;
  city?: string;
  /** Where the plate was printed, used as the default headline. */
  location?: string | null;
  /** Where "back" goes — the editor if you came through it, the plate if you came from the fork. */
  onBack: () => void;
  backLabel?: string;
}

/**
 * The payoff's own memory. Versioned and namespaced so a future shape can migrate rather than guess,
 * and read defensively: a corrupted entry falls back to the defaults instead of breaking the page.
 */
const STORE = "bahia-rosa.payoff.v1";

/** How the photograph sits in a surface. Chosen, not assumed. */
type Fit = "cover" | "contain";

interface StoredPayoff {
  copy?: Partial<PlacementCopy>;
  placement?: string;
  fit?: Fit;
  /** The subject's framing — one arrangement, applied to every surface. */
  layer?: LayerTransform;
  /** The shape this used to have, when the arrangement was kept per surface. Read, then written as `layer`. */
  layers?: Record<string, LayerTransform>;
}

/** A stored layer, read defensively: a corrupted or hostile entry becomes the default, never a NaN. */
function readLayer(value: unknown): LayerTransform | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<LayerTransform>;
  const number = (input: unknown, fallback: number, min: number, max: number): number =>
    typeof input === "number" && Number.isFinite(input) ? Math.min(max, Math.max(min, input)) : fallback;
  return {
    dx: number(candidate.dx, 0, -1.5, 1.5),
    dy: number(candidate.dy, 0, -1.5, 1.5),
    scale: number(candidate.scale, 1, 0.2, 4),
    cropTop: number(candidate.cropTop, 0, 0, 0.6),
    cropBottom: number(candidate.cropBottom, 0, 0, 0.6),
    overflow: candidate.overflow === true,
  };
}

function defaults(city: string, location: string | null | undefined): { copy: PlacementCopy; placement: string; fit: Fit; layer: LayerTransform } {
  return {
    copy: {
      city,
      handle: "@you",
      title: location ? `printed at the ${location}` : "tonight on the coast",
      line: "made it myself, out tonight",
    },
    placement: PLACEMENTS[0].id,
    // The whole photograph, by default. A surface that hides part of someone's picture should be their
    // decision — so `cover` is offered, never assumed.
    fit: "contain",
    // And the subject exactly where the press put it: centred, fitted, nothing cut. Every control below
    // starts from the honest default and only moves if the visitor moves it.
    layer: LAYER_DEFAULT,
  };
}

function restore(city: string, location: string | null | undefined): { copy: PlacementCopy; placement: string; fit: Fit; layer: LayerTransform } {
  const fallback = defaults(city, location);
  if (typeof window === "undefined") return fallback;
  try {
    const raw = window.localStorage.getItem(STORE);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as StoredPayoff;
    const known = PLACEMENTS.some((placement) => placement.id === parsed.placement);
    const placement = known ? (parsed.placement as string) : fallback.placement;
    // The arrangement used to be kept per surface. It is one arrangement now, applied everywhere — so the
    // old shape is read once, for the surface that was selected when it was made, and written back as the
    // single one. A visitor who arranged something before this change keeps their arrangement.
    const legacy = parsed.layers?.[placement] ?? Object.values(parsed.layers ?? {})[0];
    const layer = readLayer(parsed.layer) ?? readLayer(legacy) ?? fallback.layer;
    return {
      copy: { ...fallback.copy, ...parsed.copy },
      placement,
      fit: parsed.fit === "cover" || parsed.fit === "contain" ? parsed.fit : fallback.fit,
      layer,
    };
  } catch {
    return fallback;
  }
}

export function Launch({ artworkUrl, subjectUrl, city = "Bahía Rosa", location, onBack, backLabel = "Back to the editor" }: LaunchProps) {
  const first = useMemo(() => restore(city, location), [city, location]);
  const [selectedId, setSelectedId] = useState<string>(first.placement);
  const [copy, setCopy] = useState<PlacementCopy>(first.copy);
  const [fit, setFit] = useState<Fit>(first.fit);
  const [layer, setLayer] = useState<LayerTransform>(first.layer);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
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
    // A drag is a fraction of the surface, so the same gesture means the same thing on a postcard and on
    // a billboard — and a download at 1600px wide reproduces it exactly.
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

  // Kept as you type — and as you arrange. The layer belongs in the dependency list as much as the words
  // do: without it the drag updates the canvas and never reaches storage, which is a memory that looks
  // like it works until the visitor comes back.
  useEffect(() => {
    try {
      window.localStorage.setItem(
        STORE,
        JSON.stringify({ copy, placement: selectedId, fit, layer } satisfies StoredPayoff),
      );
    } catch {
      // A browser with storage disabled is not a broken page: the copy simply is not remembered.
    }
  }, [copy, selectedId, fit, layer]);

  const selected = useMemo<Placement>(
    () => PLACEMENTS.find((placement) => placement.id === selectedId) ?? PLACEMENTS[0],
    [selectedId],
  );

  const save = async (placement: Placement) => {
    setBusy(placement.id);
    setError(null);
    try {
      const blob = await composePlacement({ placement, artworkUrl, subjectUrl, copy, fit, layer });
      downloadBlob(blob, placementFilename(placement, copy.city));
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "the export failed");
    } finally {
      setBusy(null);
    }
  };

  const saveAll = async () => {
    setBusy("all");
    setError(null);
    try {
      for (const placement of PLACEMENTS) {
        const blob = await composePlacement({ placement, artworkUrl, subjectUrl, copy, fit, layer });
        downloadBlob(blob, placementFilename(placement, copy.city));
        await new Promise((resolve) => setTimeout(resolve, 400));
      }
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "the export failed");
    } finally {
      setBusy(null);
    }
  };

  return (
    <section className="section" data-testid="launch" aria-labelledby="city-heading">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h2 id="city-heading" className="display" style={{ color: "var(--color-paper)" }}>
            <span style={{ color: "var(--color-faint)" }}>~ </span>the city runs it
          </h2>
          <p className="measure mt-2 text-xs" style={{ color: "var(--color-muted)" }}>
            pick a surface. set the words. take it.
          </p>
        </div>
        <button type="button" data-testid="back-to-editor" onClick={onBack} className="btn-quiet">
          {backLabel}
        </button>
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
            style={{ touchAction: "none", cursor: dragging ? "grabbing" : "grab" }}
          >
            <PlacementCanvas placement={selected} artworkUrl={artworkUrl} subjectUrl={subjectUrl} copy={copy} fit={fit} layer={layer} className="block w-full" />
          </div>
          <p className="mt-3 text-xs" style={{ color: "var(--color-faint)" }}>
            {selected.label} · {selected.width}×{selected.height} · {selected.blurb}
          </p>
          <p className="mt-2 text-xs" style={{ color: "var(--color-muted)" }}>
            drag the frame to place yourself · arrows nudge · shift-arrows move further
          </p>
          <p className="sr-only">{selected.caption}</p>

          <div className="mt-5 flex flex-wrap items-center gap-3">
            <button
              type="button"
              data-testid={`download-${selected.id}`}
              onClick={() => void save(selected)}
              disabled={busy !== null}
              className="btn"
            >
              {busy === selected.id ? "rendering…" : `Download the ${selected.label.toLowerCase()}`}
            </button>
            <button
              type="button"
              data-testid="download-all"
              onClick={() => void saveAll()}
              disabled={busy !== null}
              className="btn-quiet"
            >
              {busy === "all" ? "rendering all four…" : "Download all four"}
            </button>
            {error ? (
              <span className="text-xs" style={{ color: "var(--color-danger)" }}>
                {error}
              </span>
            ) : null}
          </div>
        </div>

        <aside className="flex flex-col gap-8">
          <div>
            <h3 className="text-xs" style={{ color: "var(--color-muted)" }}>
              the words on it
            </h3>
            <label className="mt-4 block">
              <span className="text-xs" style={{ color: "var(--color-muted)" }}>
                handle
              </span>
              <input
                data-testid="copy-handle"
                value={copy.handle}
                onChange={(event) => setCopy((current) => ({ ...current, handle: event.target.value }))}
                className="rule mt-2 w-full border px-3 py-2 text-sm outline-none"
                style={{ background: "var(--color-ink-2)", color: "var(--color-paper)" }}
              />
            </label>
            <label className="mt-4 block">
              <span className="text-xs" style={{ color: "var(--color-muted)" }}>
                headline
              </span>
              <input
                data-testid="copy-title"
                value={copy.title}
                onChange={(event) => setCopy((current) => ({ ...current, title: event.target.value }))}
                className="rule mt-2 w-full border px-3 py-2 text-sm outline-none"
                style={{ background: "var(--color-ink-2)", color: "var(--color-paper)" }}
              />
            </label>
            <label className="mt-4 block">
              <span className="text-xs" style={{ color: "var(--color-muted)" }}>
                caption
              </span>
              <input
                data-testid="copy-line"
                value={copy.line}
                onChange={(event) => setCopy((current) => ({ ...current, line: event.target.value }))}
                className="rule mt-2 w-full border px-3 py-2 text-sm outline-none"
                style={{ background: "var(--color-ink-2)", color: "var(--color-paper)" }}
              />
            </label>
            <p className="mt-3 text-xs" style={{ color: "var(--color-faint)" }}>
              kept in this browser, so a detour does not lose them
            </p>
          </div>

          <div>
            <h3 className="text-xs" style={{ color: "var(--color-muted)" }}>
              how it sits
            </h3>
            <div
              className="mt-4 flex flex-wrap gap-3"
              role="radiogroup"
              aria-label="How the photograph sits in the surface"
            >
              {(
                [
                  ["contain", "the whole photo", "nothing cropped — the leftover frame becomes a mount"],
                  ["cover", "fill the frame", "crops the edges so the surface is full"],
                ] as const
              ).map(([id, label, hint]) => (
                <button
                  key={id}
                  type="button"
                  role="radio"
                  data-testid={`fit-${id}`}
                  aria-checked={fit === id}
                  onClick={() => setFit(id)}
                  className="lift text-left"
                  style={{
                    border: `1px solid ${fit === id ? "var(--color-accent)" : "var(--color-rule)"}`,
                    padding: "10px 14px",
                  }}
                >
                  <span
                    className="block text-xs"
                    style={{ color: fit === id ? "var(--color-accent)" : "var(--color-paper)" }}
                  >
                    {label}
                    {fit === id ? " · chosen" : ""}
                  </span>
                  <span className="block text-xs" style={{ color: "var(--color-faint)" }}>
                    {hint}
                  </span>
                </button>
              ))}
            </div>
            <p className="mt-3 text-xs" style={{ color: "var(--color-faint)" }}>
              applies to all four surfaces, and to the downloads
            </p>
          </div>

          <div className="mt-8">
            <h3 className="text-xs" style={{ color: "var(--color-muted)" }}>
              the layer
            </h3>
            <p className="measure mt-2 text-xs" style={{ color: "var(--color-faint)" }}>
              one arrangement, applied to all four surfaces and to the downloads — however many of you are in
              the photograph, since a group is painted as one and moves, sizes and cuts as one. drag the frame
              above, or nudge with the arrow keys.
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

          <div>
            <h3 className="text-xs" style={{ color: "var(--color-muted)" }}>
              where it runs
            </h3>
            <div className="mt-4 grid grid-cols-2 gap-3" role="group" aria-label="Where it runs">
              {PLACEMENTS.map((placement) => (
                <button
                  key={placement.id}
                  type="button"
                  data-testid={`place-${placement.id}`}
                  aria-pressed={placement.id === selected.id}
                  onClick={() => setSelectedId(placement.id)}
                  className="lift text-left"
                  style={{
                    border: `1px solid ${placement.id === selected.id ? "var(--color-accent)" : "var(--color-rule)"}`,
                    padding: "6px",
                  }}
                >
                  <PlacementCanvas placement={placement} artworkUrl={artworkUrl} subjectUrl={subjectUrl} copy={copy} fit={fit} layer={layer} className="block w-full" />
                  <span className="mt-2 block px-1 pb-1 text-xs" style={{ color: "var(--color-muted)" }}>
                    {placement.label.toLowerCase()}
                  </span>
                </button>
              ))}
            </div>
          </div>
        </aside>
      </div>
    </section>
  );
}