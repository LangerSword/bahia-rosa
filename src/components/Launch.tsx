import { useMemo, useState } from "react";
import { PlacementCanvas } from "./PlacementCanvas";
import { composePlacement, downloadBlob, placementFilename } from "../world/compose";
import { PLACEMENTS, type Placement, type PlacementCopy } from "../world/placements";

/**
 * Step 3 — take the city.
 *
 * The payoff, and the reason the editor exists: the artwork you just made is not a file in a folder,
 * it is tonight's poster. Pick a surface, the city runs it, download the placement or the postcard.
 *
 * Every preview here is drawn by the exporter (`PlacementCanvas` → `drawPlacement`), so a download is
 * the preview at full resolution and not a second rendering of it.
 */

export interface LaunchProps {
  artworkUrl: string;
  city?: string;
  /** Where the plate was printed, used as the default headline. */
  location?: string | null;
  onBackToEditor: () => void;
}

export function Launch({ artworkUrl, city = "Bahía Rosa", location, onBackToEditor }: LaunchProps) {
  const [selectedId, setSelectedId] = useState<string>(PLACEMENTS[0].id);
  const [copy, setCopy] = useState<PlacementCopy>({
    city,
    handle: "@you",
    title: location ? `printed at the ${location}` : "tonight on the coast",
    line: "made it myself, out tonight",
  });
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

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
    <section className="panel rule border p-8" data-testid="launch">
      <header className="rule mb-6 flex flex-wrap items-end justify-between gap-4 border-b pb-4">
        <div>
          <p className="kicker">Step 3 · Launch</p>
          <h2 className="display mt-3 text-4xl">Take the city</h2>
          <p className="mt-3 max-w-[62ch] text-sm leading-relaxed text-[color:var(--color-muted)]">
            Your artwork is tonight&rsquo;s poster. Choose the surface the city runs it on, then take it
            with you — each placement downloads at full resolution, drawn by the same code that draws
            the preview.
          </p>
        </div>
        <button
          type="button"
          data-testid="back-to-editor"
          onClick={onBackToEditor}
          className="lift rule border px-4 py-2 text-xs tracking-[0.2em] text-[color:var(--color-body)] uppercase hover:text-[color:var(--color-gold)]"
        >
          Back to the editor
        </button>
      </header>

      <div className="grid gap-8 lg:grid-cols-[1fr_minmax(260px,320px)]">
        <div>
          <div className="plinth rule border">
            <PlacementCanvas placement={selected} artworkUrl={artworkUrl} copy={copy} className="block w-full" />
          </div>
          <p className="mt-3 font-mono text-[11px] text-[color:var(--color-faint)]">
            {selected.label} · {selected.width}×{selected.height} · {selected.blurb}
          </p>
          <p className="sr-only">{selected.caption}</p>

          <div className="mt-5 flex flex-wrap items-center gap-3">
            <button
              type="button"
              data-testid={`download-${selected.id}`}
              onClick={() => void save(selected)}
              disabled={busy !== null}
              className="lift rule border border-[color:var(--color-gold)] px-5 py-2.5 text-xs tracking-[0.2em] text-[color:var(--color-gold)] uppercase disabled:opacity-40"
            >
              {busy === selected.id ? "rendering…" : `Download the ${selected.label.toLowerCase()}`}
            </button>
            <button
              type="button"
              data-testid="download-all"
              onClick={() => void saveAll()}
              disabled={busy !== null}
              className="lift rule border px-5 py-2.5 text-xs tracking-[0.2em] text-[color:var(--color-body)] uppercase disabled:opacity-40"
            >
              {busy === "all" ? "rendering all four…" : "Download all four"}
            </button>
            {error ? <span className="font-mono text-[11px] text-[color:var(--color-danger)]">{error}</span> : null}
          </div>
        </div>

        <aside className="flex flex-col gap-6">
          <div className="rule border p-5">
            <p className="kicker">The copy on it</p>
            <label className="mt-4 block">
              <span className="font-mono text-[11px] tracking-[0.2em] text-[color:var(--color-muted)] uppercase">Handle</span>
              <input
                data-testid="copy-handle"
                value={copy.handle}
                onChange={(event) => setCopy((current) => ({ ...current, handle: event.target.value }))}
                className="rule mt-2 w-full border bg-[color:var(--color-ink-2)] px-3 py-2 text-sm text-[color:var(--color-paper)] outline-none focus-visible:border-[color:var(--color-gold)]"
              />
            </label>
            <label className="mt-4 block">
              <span className="font-mono text-[11px] tracking-[0.2em] text-[color:var(--color-muted)] uppercase">Headline</span>
              <input
                data-testid="copy-title"
                value={copy.title}
                onChange={(event) => setCopy((current) => ({ ...current, title: event.target.value }))}
                className="rule mt-2 w-full border bg-[color:var(--color-ink-2)] px-3 py-2 text-sm text-[color:var(--color-paper)] outline-none focus-visible:border-[color:var(--color-gold)]"
              />
            </label>
            <label className="mt-4 block">
              <span className="font-mono text-[11px] tracking-[0.2em] text-[color:var(--color-muted)] uppercase">Caption</span>
              <input
                data-testid="copy-line"
                value={copy.line}
                onChange={(event) => setCopy((current) => ({ ...current, line: event.target.value }))}
                className="rule mt-2 w-full border bg-[color:var(--color-ink-2)] px-3 py-2 text-sm text-[color:var(--color-paper)] outline-none focus-visible:border-[color:var(--color-gold)]"
              />
            </label>
          </div>

          <div>
            <p className="kicker">Where it runs</p>
            <div className="mt-4 grid grid-cols-2 gap-3">
              {PLACEMENTS.map((placement) => (
                <button
                  key={placement.id}
                  type="button"
                  data-testid={`place-${placement.id}`}
                  aria-pressed={placement.id === selected.id}
                  onClick={() => setSelectedId(placement.id)}
                  className={`lift rule border p-1.5 text-left ${
                    placement.id === selected.id
                      ? "border-[color:var(--color-gold)] bg-[color:var(--color-ink-2)]"
                      : "hover:border-[color:var(--color-muted)]"
                  }`}
                >
                  <PlacementCanvas placement={placement} artworkUrl={artworkUrl} copy={copy} className="block w-full" />
                  <span className="mt-2 block px-1 pb-1 font-mono text-[10px] tracking-[0.14em] text-[color:var(--color-muted)] uppercase">
                    {placement.label}
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
