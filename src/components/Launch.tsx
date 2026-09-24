import { useEffect, useMemo, useState } from "react";
import { PlacementCanvas } from "./PlacementCanvas";
import { composePlacement, downloadBlob, placementFilename } from "../world/compose";
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

interface StoredPayoff {
  copy?: Partial<PlacementCopy>;
  placement?: string;
}

function defaults(city: string, location: string | null | undefined): { copy: PlacementCopy; placement: string } {
  return {
    copy: {
      city,
      handle: "@you",
      title: location ? `printed at the ${location}` : "tonight on the coast",
      line: "made it myself, out tonight",
    },
    placement: PLACEMENTS[0].id,
  };
}

function restore(city: string, location: string | null | undefined): { copy: PlacementCopy; placement: string } {
  const fallback = defaults(city, location);
  if (typeof window === "undefined") return fallback;
  try {
    const raw = window.localStorage.getItem(STORE);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as StoredPayoff;
    const known = PLACEMENTS.some((placement) => placement.id === parsed.placement);
    return {
      copy: { ...fallback.copy, ...parsed.copy },
      placement: known ? (parsed.placement as string) : fallback.placement,
    };
  } catch {
    return fallback;
  }
}

export function Launch({ artworkUrl, city = "Bahía Rosa", location, onBack, backLabel = "Back to the editor" }: LaunchProps) {
  const first = useMemo(() => restore(city, location), [city, location]);
  const [selectedId, setSelectedId] = useState<string>(first.placement);
  const [copy, setCopy] = useState<PlacementCopy>(first.copy);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Kept as you type: the whole point is that a detour does not cost you the words.
  useEffect(() => {
    try {
      window.localStorage.setItem(STORE, JSON.stringify({ copy, placement: selectedId } satisfies StoredPayoff));
    } catch {
      // A browser with storage disabled is not a broken page: the copy simply is not remembered.
    }
  }, [copy, selectedId]);

  const selected = useMemo<Placement>(
    () => PLACEMENTS.find((placement) => placement.id === selectedId) ?? PLACEMENTS[0],
    [selectedId],
  );

  const save = async (placement: Placement) => {
    setBusy(placement.id);
    setError(null);
    try {
      const blob = await composePlacement({ placement, artworkUrl, copy });
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
        const blob = await composePlacement({ placement, artworkUrl, copy });
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
            Your frame is tonight&rsquo;s poster. Pick the surface, set the words on it, take it with you
            — every download is full resolution, drawn by the same code that draws the preview.
          </p>
        </div>
        <button type="button" data-testid="back-to-editor" onClick={onBack} className="btn-quiet">
          {backLabel}
        </button>
      </div>

      <div className="mt-6 grid gap-8 lg:grid-cols-[1fr_minmax(260px,320px)]">
        <div>
          <div className="plate-inset">
            <PlacementCanvas placement={selected} artworkUrl={artworkUrl} copy={copy} className="block w-full" />
          </div>
          <p className="mt-3 text-xs" style={{ color: "var(--color-faint)" }}>
            {selected.label} · {selected.width}×{selected.height} · {selected.blurb}
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
                  <PlacementCanvas placement={placement} artworkUrl={artworkUrl} copy={copy} className="block w-full" />
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