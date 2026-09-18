import { useCallback, useState } from "react";
import { EditorSurface, type ToolGating } from "./components/EditorSurface";

/**
 * Surface 1 — LOADING SCREEN (brief: clean grade, subject centred, name plate clear).
 * Gating is deliberate level design: this surface only exposes crop, resize, frame and text.
 * See docs/editor-contract.md §"Tool gating" and plan §3.6.
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

export function App() {
  const [saved, setSaved] = useState<string | null>(null);

  const onSaved = useCallback((dataUrl: string) => setSaved(dataUrl), []);

  return (
    <main className="mx-auto max-w-[1440px] px-8 py-10">
      <header className="mb-8">
        <p className="text-xs tracking-[0.35em] text-paper/60 uppercase">Bahía Rosa · La Gaviota</p>
        <h1 className="font-display text-6xl leading-none tracking-tight">FIFTEEN MINUTES</h1>
        <p className="mt-2 max-w-prose text-sm text-paper/70">
          Your face, on everything the city prints. Boot build — the editor is mounted below with the
          loading-screen tool gating.
        </p>
      </header>

      <section className="editor-shell">
        <EditorSurface
          surfaceId="loading"
          image={`${import.meta.env.BASE_URL}art/demo/placeholder.png`}
          gating={LOADING_GATING}
          onSaved={onSaved}
        />
      </section>

      {saved ? (
        <section className="mt-8">
          <h2 className="font-display text-2xl">Saved (metrics + grading land in Session C)</h2>
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
