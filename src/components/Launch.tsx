import { useEffect, useMemo, useState } from "react";
import { PlacementCanvas } from "./PlacementCanvas";
import { composePlacement, downloadBlob, isDefaultLayer, placementFilename } from "../world/compose";
import { PLACEMENTS, type Placement, type PlacementCopy } from "../world/placements";
import type { Fit } from "../lib/payoff";

/**
 * The payoff — the part of the product that justifies the editor.
 *
 * The city prints. It does not arrange: the arrangement happens in the phase where the picture is made,
 * one arrangement for all four surfaces, and what arrives here is a decision already taken. That is the
 * whole reason there is no drag surface on this stage — a visitor arranging inside a billboard's 8:3 mount
 * and then in a venue card's 3:4 is being asked the same question twice with two different answers.
 *
 * What is left here is what the surfaces are for: the words on them, how the photograph sits, and the
 * downloads. Every preview is drawn by the exporter (`PlacementCanvas` → `drawPlacement`), so a download
 * *is* the preview at full resolution, not a second rendering of it.
 */

export interface LaunchProps {
  artworkUrl: string;
  /** The person on their own, when the press kept the layers apart — what the arrangement moved. */
  subjectUrl?: string;
  /**
   * Whether the arrangement applies to these surfaces. The city's own plates are arranged; "as it is" is
   * the visitor's own room, where they stand where they stood.
   */
  arranging?: boolean;
  copy: PlacementCopy;
  setCopy: (next: PlacementCopy | ((current: PlacementCopy) => PlacementCopy)) => void;
  fit: Fit;
  setFit: (fit: Fit) => void;
  /** The arrangement, read here and set in the editing phase. */
  layer: import("../world/compose").LayerTransform;
  placementId: string;
  setPlacementId: (id: string) => void;
  /** Where "back" goes — the editor if you came through it, the plate if you came from the fork. */
  onBack: () => void;
  backLabel?: string;
}

export function Launch({
  artworkUrl,
  subjectUrl,
  arranging = true,
  copy,
  setCopy,
  fit,
  setFit,
  layer,
  placementId,
  setPlacementId,
  onBack,
  backLabel = "Back to the editor",
}: LaunchProps) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  /** What every surface draws: the arrangement made in the editing phase, or the press's own framing. */
  const arranged = arranging ? layer : undefined;
  const arrangedLine = !subjectUrl
    ? "one picture — an edit is flattened, so this is the frame as it was saved"
    : arranging
      ? isDefaultLayer(layer)
        ? "the press's own framing — arrange them in the editing phase if you want them moved"
        : "arranged in the editing phase · the same arrangement on all four"
      : "your own room: they stand where they stood";

  const selected = useMemo<Placement>(
    () => PLACEMENTS.find((placement) => placement.id === placementId) ?? PLACEMENTS[0],
    [placementId],
  );

  // Kept in the page as well as in storage while this stage is open: the store is written by the payoff
  // hook, and this only refreshes the surface when a different one is chosen.
  useEffect(() => {
    setError(null);
  }, [selected.id]);

  const save = async (placement: Placement) => {
    setBusy(placement.id);
    setError(null);
    try {
      const blob = await composePlacement({ placement, artworkUrl, subjectUrl, copy, fit, layer: arranged });
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
        const blob = await composePlacement({ placement, artworkUrl, subjectUrl, copy, fit, layer: arranged });
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
          <div className="plate-inset">
            <PlacementCanvas
              placement={selected}
              artworkUrl={artworkUrl}
              subjectUrl={subjectUrl}
              copy={copy}
              fit={fit}
              layer={arranged}
              className="block w-full"
            />
          </div>
          <p className="mt-3 text-xs" style={{ color: "var(--color-faint)" }}>
            {selected.label} · {selected.width}×{selected.height} · {selected.blurb}
          </p>
          <p className="mt-2 text-xs" style={{ color: "var(--color-muted)" }} data-testid="arrangement-note">
            {arrangedLine}
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
                  onClick={() => setPlacementId(placement.id)}
                  className="lift text-left"
                  style={{
                    border: `1px solid ${placement.id === selected.id ? "var(--color-accent)" : "var(--color-rule)"}`,
                    padding: "6px",
                  }}
                >
                  <PlacementCanvas
                    placement={placement}
                    artworkUrl={artworkUrl}
                    subjectUrl={subjectUrl}
                    copy={copy}
                    fit={fit}
                    layer={arranged}
                    className="block w-full"
                  />
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