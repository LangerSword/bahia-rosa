import { useCallback, useState } from "react";
import { motion, useReducedMotion } from "motion/react";
import { EditorSurface, type ToolGating } from "./components/EditorSurface";
import { PlateGate, type PrintChoice } from "./components/PlateGate";
import { PrintDesk } from "./components/PrintDesk";
import { plateFromBaked, type PlateSource } from "./lib/plates/plates";
import { printChoices } from "./lib/printdesk/client";

/**
 * FIRST EDITION — the city's media machine.
 *
 * The shell follows the studio-site language measured in src/index.css: near-black canvas, deep
 * gradient panels, one gold accent, Art Deco display caps over a grotesque text face, and motion that
 * reveals rather than performs. Each stage is a surface, and each surface exposes a different tool set
 * in the editor — that gating is the level design (docs/editor-contract.md).
 */

const TITLE_GATING: ToolGating = { crop: true, resize: true, frame: true, text: true, filter: false, draw: false, shapes: false, stickers: false };
const PAGE_GATING: ToolGating = { crop: true, resize: true, filter: true, text: true, frame: false, draw: false, shapes: false, stickers: false };
const POSTER_GATING: ToolGating = { crop: true, resize: true, filter: true, text: true, frame: true, draw: true, shapes: true, stickers: true };

/** Which editor surface a printed style leads into, and what that surface asks for. */
const PLANS: Record<string, { surfaceId: string; title: string; brief: string; gating: ToolGating }> = {
  debut: { surfaceId: "loading", title: "the loading screen", brief: "clean grade, face centred, name plate clear", gating: TITLE_GATING },
  loadingscreen: { surfaceId: "loading", title: "the loading screen", brief: "painted panel — put your name in the clear band along the bottom", gating: TITLE_GATING },
  frontpage: { surfaceId: "frontpage", title: "the front page", brief: "face above the fold, masthead clear, tabloid drama", gating: PAGE_GATING },
  poster: { surfaceId: "poster", title: "the VIP poster", brief: "sell the room; you are the night's draw", gating: POSTER_GATING },
};

/** Offered when no local desk is running, so the experience never dead-ends. */
const FALLBACK_PLATE = {
  id: "marisol",
  label: "Marisol",
  note: "Cast plate — a fictional character printed earlier.",
  src: `${import.meta.env.BASE_URL}art/demo/s1-marisol-keyart.jpg`,
};

type Stage = "gate" | "printing" | "editing";

const { locations } = printChoices();

const reveal = { hidden: { opacity: 0, y: 18 }, shown: { opacity: 1, y: 0 } };
const EASE = [0.22, 1, 0.36, 1] as const;

export function App() {
  const [stage, setStage] = useState<Stage>("gate");
  const [pendingPhoto, setPendingPhoto] = useState<File | null>(null);
  const [choice, setChoice] = useState<PrintChoice>({ surface: "debut", quality: false });
  const [plate, setPlate] = useState<PlateSource | null>(null);
  const [meta, setMeta] = useState<{ register: string; location: string | null; seed: number } | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const reduce = useReducedMotion();

  const onSaved = useCallback((dataUrl: string) => setSaved(dataUrl), []);
  const image = plate ? (plate.kind === "photo" ? plate.objectUrl : plate.src) : null;
  const plan = PLANS[choice.surface] ?? PLANS.debut;

  const printed = useCallback(
    (next: PlateSource, printedMeta: { register: string; location: string | null; seed: number }) => {
      setPlate(next);
      setMeta(printedMeta);
      setStage("editing");
    },
    [],
  );

  const useFallback = useCallback(() => {
    setPlate(plateFromBaked(FALLBACK_PLATE));
    setMeta(null);
    setStage("editing");
  }, []);

  const reset = useCallback(() => {
    setPlate(null);
    setPendingPhoto(null);
    setSaved(null);
    setMeta(null);
    setStage("gate");
  }, []);

  return (
    <div className="min-h-screen">
      <header className="rule sticky top-0 z-20 border-b bg-[color:var(--color-ink)]/85 backdrop-blur">
        <div className="mx-auto flex max-w-[1280px] items-center justify-between gap-6 px-8 py-4">
          <div className="flex items-baseline gap-4">
            <span className="wordmark text-3xl leading-none">First Edition</span>
            <span className="kicker hidden sm:inline">Bahía Rosa · La Gaviota</span>
          </div>
          <div className="flex items-center gap-6">
            <span className="kicker hidden md:inline">{locations.length} places</span>
            <span className="kicker" style={{ color: "var(--color-gold)" }}>
              local desk
            </span>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-[1280px] px-8">
        <motion.section
          initial={reduce ? undefined : "hidden"}
          animate={reduce ? undefined : "shown"}
          variants={reveal}
          transition={{ duration: 0.7, ease: EASE }}
          className="panel-slate sheen rule relative mt-8 overflow-hidden border px-10 py-16"
        >
          <p className="kicker">The city prints you</p>
          <h1 className="display mt-5 text-6xl sm:text-7xl">First Edition</h1>
          <p className="mt-6 max-w-[52ch] text-base leading-relaxed text-[color:var(--color-body)]">
            Bring one photo. The desk — a model running on this machine, no account and no key —
            restyles you in the city's own light, at a place you choose. Then the media machine wants
            that face in its own formats, and{" "}
            <span className="text-[color:var(--color-paper)]">the editor is the only thing you produce with</span>.
          </p>
          <div className="mt-10 flex flex-wrap items-center gap-x-8 gap-y-3">
            {["character shot", "loading screen", "front page", "poster"].map((item) => (
              <span key={item} className="kicker" style={{ color: "var(--color-paper)" }}>
                {item}
              </span>
            ))}
          </div>
        </motion.section>

        <div className="rule mt-8 overflow-hidden border-y py-3">
          <div className="ticker kicker">
            {[...locations, ...locations].map((place, index) => (
              <span key={`${place.id}-${index}`} className="mx-6">
                {place.label} <span style={{ color: "var(--color-gold)" }}>·</span>
              </span>
            ))}
          </div>
        </div>

        {stage === "gate" ? (
          <motion.div
            initial={reduce ? undefined : "hidden"}
            whileInView={reduce ? undefined : "shown"}
            viewport={{ once: true, margin: "-80px" }}
            variants={reveal}
            transition={{ duration: 0.6, ease: EASE }}
            className="mt-10"
          >
            <PlateGate
              onPhoto={(file, picked) => {
                setPendingPhoto(file);
                setChoice(picked);
                setStage("printing");
              }}
              onPlate={(baked) => {
                setPlate(baked);
                setMeta(null);
                setStage("editing");
              }}
            />
          </motion.div>
        ) : null}

        {stage === "printing" && pendingPhoto ? (
          <div className="mt-10">
            <PrintDesk file={pendingPhoto} choice={choice} onPrinted={printed} onUseCastPlate={useFallback} />
          </div>
        ) : null}

        {stage === "editing" && image ? (
          <motion.section
            initial={reduce ? undefined : { opacity: 0, y: 14 }}
            animate={reduce ? undefined : { opacity: 1, y: 0 }}
            transition={{ duration: 0.5, ease: EASE }}
            className="editor-shell panel rule mt-10 border p-8"
          >
            <div className="rule mb-5 flex items-center justify-between border-b pb-4">
              <div>
                <p className="kicker">Step 2</p>
                <h2 className="display mt-2 text-3xl">{plan.title}</h2>
              </div>
              <button
                type="button"
                data-testid="start-over"
                onClick={reset}
                className="lift rule border px-4 py-2 text-xs tracking-[0.2em] text-[color:var(--color-body)] uppercase hover:text-[color:var(--color-gold)]"
              >
                Start over
              </button>
            </div>
            <p className="mb-5 max-w-[62ch] text-sm leading-relaxed text-[color:var(--color-muted)]">
              Brief: {plan.brief}.
              {meta?.location ? <span> Printed at the {meta.location}.</span> : null}
              {plate?.kind === "plate" ? <span> (Using a cast plate.)</span> : null}
            </p>
            <EditorSurface surfaceId={plan.surfaceId} image={image} gating={plan.gating} onSaved={onSaved} />
          </motion.section>
        ) : null}

        {saved ? (
          <motion.section
            initial={reduce ? undefined : { opacity: 0, y: 14 }}
            animate={reduce ? undefined : { opacity: 1, y: 0 }}
            transition={{ duration: 0.5, ease: EASE }}
            className="panel-navy rule mt-8 border p-8"
          >
            <p className="kicker">Filed</p>
            <h2 className="display mt-3 text-2xl">Saved — grading lands next</h2>
            <img src={saved} alt="Saved edit" className="rule mt-5 w-[320px] border" />
          </motion.section>
        ) : null}
      </main>

      <footer className="rule mx-auto mt-16 max-w-[1280px] border-t px-8 py-8">
        <p className="kicker">First Edition · Bahía Rosa</p>
        <p className="mt-3 max-w-[70ch] text-xs leading-relaxed text-[color:var(--color-faint)]">
          Unofficial fan-made project for the Unlayer Build with React Image Editor Challenge. Not
          affiliated with, endorsed by, or connected to Rockstar Games or Take-Two Interactive. All
          visuals are original work; the city (Bahía Rosa) and its newspaper (LA GAVIOTA) are invented.
        </p>
      </footer>
    </div>
  );
}
