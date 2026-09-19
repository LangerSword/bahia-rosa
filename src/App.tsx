import { useCallback, useState } from "react";
import { EditorSurface, type ToolGating } from "./components/EditorSurface";
import { PlateGate } from "./components/PlateGate";
import { PrintDesk } from "./components/PrintDesk";
import { plateFromBaked, type PlateSource } from "./lib/plates/plates";

/**
 * Surface 1 — LOADING SCREEN (brief: clean grade, subject centred, name plate clear).
 * Gating is deliberate level design: this surface only exposes crop, resize, frame and text.
 * See docs/editor-contract.md, docs/look.md and docs/print-desk.md.
 */
const LOADING_GATING: ToolGating = {
  crop: true,
  resize: true,
  frame: true,
  text: true,
  filter: false,
  draw: false,
  shapes: false,
  stickers: false,
};

/** Offered when no local desk is running, so the experience never dead-ends. */
const FALLBACK_PLATE = {
  id: "marisol",
  label: "Marisol",
  note: "Cast plate — a fictional character printed earlier.",
  src: `${import.meta.env.BASE_URL}art/demo/s1-marisol-keyart.jpg`,
};

type Stage = "gate" | "printing" | "editing";

export function App() {
  const [stage, setStage] = useState<Stage>("gate");
  const [pendingPhoto, setPendingPhoto] = useState<File | null>(null);
  const [plate, setPlate] = useState<PlateSource | null>(null);
  const [saved, setSaved] = useState<string | null>(null);

  const onSaved = useCallback((dataUrl: string) => setSaved(dataUrl), []);

  const image = plate ? (plate.kind === "photo" ? plate.objectUrl : plate.src) : null;

  const printed = useCallback((next: PlateSource) => {
    setPlate(next);
    setStage("editing");
  }, []);

  const useFallback = useCallback(() => {
    setPlate(plateFromBaked(FALLBACK_PLATE));
    setStage("editing");
  }, []);

  return (
    <main className="mx-auto max-w-[1440px] px-8 py-10">
      <header className="mb-8">
        <p className="text-xs tracking-[0.35em] text-paper/60 uppercase">Bahía Rosa · La Gaviota</p>
        <h1 className="font-display text-6xl leading-none tracking-tight">FIFTEEN MINUTES</h1>
        <p className="mt-2 max-w-prose text-sm text-paper/70">
          Your face, on everything the city prints. Bring a photo — the desk restyles it in the
          city's own light — then take the loading screen and the front page.
        </p>
      </header>

      {stage === "gate" ? (
        <PlateGate
          onPhoto={(file) => {
            setPendingPhoto(file);
            setStage("printing");
          }}
          onPlate={(baked) => {
            setPlate(baked);
            setStage("editing");
          }}
        />
      ) : null}

      {stage === "printing" && pendingPhoto ? (
        <PrintDesk file={pendingPhoto} onPrinted={printed} onUseCastPlate={useFallback} />
      ) : null}

      {stage === "editing" && image ? (
        <section className="editor-shell">
          <div className="mb-4 flex items-center justify-between border-b border-paper/15 pb-3">
            <h2 className="font-display text-2xl">Step 2 — the loading screen</h2>
            <button
              type="button"
              data-testid="start-over"
              onClick={() => {
                setPlate(null);
                setPendingPhoto(null);
                setSaved(null);
                setStage("gate");
              }}
              className="border border-paper/30 px-3 py-1 text-xs tracking-wide uppercase hover:bg-paper/10"
            >
              Start over
            </button>
          </div>
          <p className="mb-4 max-w-prose text-sm text-paper/70">
            Brief: clean grade, face centred, name plate clear. You get crop, resize, frame and text —
            nothing else. This is the shot the city opens with.
            {plate?.kind === "plate" ? <span className="text-paper/50"> (Using a cast plate.)</span> : null}
          </p>
          <EditorSurface surfaceId="loading" image={image} gating={LOADING_GATING} onSaved={onSaved} />
        </section>
      ) : null}

      {saved ? (
        <section className="mt-8">
          <h2 className="font-display text-2xl">Saved (grading lands next)</h2>
          <img src={saved} alt="Saved edit" className="mt-3 w-[320px] border border-paper/20" />
        </section>
      ) : null}

      <footer className="mt-12 border-t border-paper/15 pt-4 text-xs text-paper/50">
        Unofficial fan-made project for the Unlayer Build with React Image Editor Challenge. Not
        affiliated with, endorsed by, or connected to Rockstar Games or Take-Two Interactive.
      </footer>
    </main>
  );
}
