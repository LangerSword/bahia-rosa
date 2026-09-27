import { useEffect, useRef, useState, type ReactElement } from "react";

/**
 * The film on the title sheet: the city plate being generated.
 *
 * A sequence with a motion vocabulary, not a slideshow. It opens on the city's own card — the wordmark set in
 * Limelight, the face the title will arrive in, with the gold hairline drawn under it — and then:
 *
 *   · the **build** arrives by *press-wipe*: each layer sweeps across the plate behind a travelling gold print
 *     head, because that is what a plate is — one pass laid over the last;
 *   · the **tour** arrives by *push*: each place comes in on a slow 1.03 → 1.0 camera move rather than a cut;
 *   · the **hand-off** dissolves into the sheet, so the title assembles out of the film rather than replacing
 *     it.
 *
 * Type is DOM and only the pictures are canvas, which is the right split: the card, the step's name and the
 * counter stay crisp at any resolution and cost React nothing; a canvas is needed for frames and nothing else.
 * No faces anywhere — these are the plates the city draws of itself. The frames come from
 * `tools/make-film.mjs`, which calls this app's own `gradePixels` and `styliseImageData`, so the film is the
 * pipeline rather than a picture of it.
 *
 * It cannot hold the entry hostage: if the sprite does not arrive within `GUARD_MS`, or fails, or the canvas is
 * unavailable, `onDone` fires. Reduced motion never mounts it, and `?film=0` skips it for a probe.
 */
const CELL_W = 1600;
const CELL_H = 900;
const COLS = 6;
const GUARD_MS = 8000;

/** The card is step 0; the cells are steps 1..12. Every step names itself while it happens. */
const CARD_MS = 900;
const CARD_LABEL = "the press, at work";
const OUT_MS = 340;

type Move = "wipe" | "push";
interface Beat {
  /** The sprite cell this beat shows. */
  cell: number;
  label: string;
  /** How the beat arrives, how long the arrival takes, and how long the frame then holds still. */
  move: Move;
  moveMs: number;
  holdMs: number;
}

/** The build's layers in the press's order, then the city at other hours — mirrors `tools/make-film.mjs`. */
const BEATS: Beat[] = [
  { cell: 0, label: "the city's own drawing", move: "wipe", moveMs: 480, holdMs: 100 },
  { cell: 1, label: "the hour — dusk", move: "wipe", moveMs: 480, holdMs: 100 },
  { cell: 2, label: "the flat shapes", move: "wipe", moveMs: 480, holdMs: 100 },
  { cell: 3, label: "+ the ink lines", move: "wipe", moveMs: 480, holdMs: 100 },
  { cell: 4, label: "+ the detail", move: "wipe", moveMs: 480, holdMs: 100 },
  { cell: 5, label: "+ more colours — 12", move: "wipe", moveMs: 480, holdMs: 100 },
  { cell: 6, label: "the plate — with its paper", move: "wipe", moveMs: 520, holdMs: 220 },
  { cell: 7, label: "the marina, at golden hour", move: "push", moveMs: 280, holdMs: 90 },
  { cell: 8, label: "the rooftop, at night", move: "push", moveMs: 280, holdMs: 90 },
  { cell: 9, label: "palm boulevard, in the neon", move: "push", moveMs: 280, holdMs: 90 },
  { cell: 10, label: "the beach, after dark", move: "push", moveMs: 280, holdMs: 90 },
  { cell: 11, label: "the marina, at dusk", move: "push", moveMs: 280, holdMs: 90 },
];
const STEPS = BEATS.length + 1;

export function PlateFilm({ onDone }: { onDone: () => void }): ReactElement {
  const ref = useRef<HTMLCanvasElement>(null);
  const done = useRef(false);
  const [step, setStep] = useState(0);
  const [out, setOut] = useState(false);
  /** The callback through a ref: a parent re-render must not restart the film by handing over a new function. */
  const finish = useRef(onDone);
  finish.current = onDone;

  useEffect(() => {
    let live = true;
    let timer = 0;
    let frame = 0;

    const call = (): void => {
      if (done.current) return;
      done.current = true;
      finish.current();
    };

    const guard = window.setTimeout(call, GUARD_MS);

    const sprite = new Image();
    sprite.decoding = "async";
    sprite.src = `${import.meta.env.BASE_URL}film/plate-film.jpg`;
    sprite.onerror = (): void => {
      window.clearTimeout(guard);
      call();
    };
    sprite.onload = (): void => {
      window.clearTimeout(guard);
      if (!live) return;
      const canvas = ref.current;
      const ctx = canvas?.getContext("2d");
      if (!canvas || !ctx) {
        call();
        return;
      }

      // One to one, on purpose: the cells are 1600×900, so drawing them at device resolution would upscale
      // them on a retina screen and soften exactly the ink lines the build exists to show.
      const cw = Math.max(320, Math.round(canvas.clientWidth || 1280));
      const ch = Math.max(180, Math.round(canvas.clientHeight || 720));
      canvas.width = cw;
      canvas.height = ch;
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = "high";

      /** One cell, cover-fitted, optionally pushed (scale) and faded (alpha) — the only place the sprite is read. */
      const cover = (into: CanvasRenderingContext2D, index: number, scale = 1, alpha = 1): void => {
        const sx = (index % COLS) * CELL_W;
        const sy = Math.floor(index / COLS) * CELL_H;
        const fit = Math.max(cw / CELL_W, ch / CELL_H) * scale;
        const dw = CELL_W * fit;
        const dh = CELL_H * fit;
        into.globalAlpha = alpha;
        into.drawImage(sprite, sx, sy, CELL_W, CELL_H, (cw - dw) / 2, (ch - dh) / 2, dw, dh);
        into.globalAlpha = 1;
      };

      /** The frame being replaced, kept offscreen so every arrival has something to arrive *over*. */
      const back = document.createElement("canvas");
      back.width = cw;
      back.height = ch;
      const backCtx = back.getContext("2d");

      /**
       * The press-wipe: the new layer laid across the plate behind a travelling gold print head.
       *
       * The seam is *feathered*. A hard edge through a picture reads as a stitching artifact — it was reported
       * as one — so the layer's bulk arrives hard (the plate stays crisp) and a narrow band around the seam is
       * drawn soft. That leaves the head as the only hard thing in the frame, which is exactly what makes it
       * read as a press pass rather than a glitch.
       */
      const wipe = (to: number, t: number): void => {
        ctx.clearRect(0, 0, cw, ch);
        if (backCtx) ctx.drawImage(back, 0, 0);
        const x = Math.max(0, Math.min(cw, cw * t));
        const feather = 22;
        ctx.save();
        ctx.beginPath();
        ctx.rect(0, 0, x, ch);
        ctx.clip();
        cover(ctx, to);
        ctx.restore();
        if (x > feather && x < cw + feather) {
          ctx.save();
          ctx.beginPath();
          ctx.rect(x - feather, 0, feather * 2, ch);
          ctx.clip();
          if ("filter" in ctx) ctx.filter = `blur(${feather}px)`;
          cover(ctx, to);
          ctx.filter = "none";
          ctx.restore();
        }
        if (x > 0 && x < cw) {
          const trail = ctx.createLinearGradient(x - 130, 0, x, 0);
          trail.addColorStop(0, "rgba(251,191,36,0)");
          trail.addColorStop(1, "rgba(251,191,36,0.3)");
          ctx.fillStyle = trail;
          ctx.fillRect(x - 130, 0, 130, ch);
          const glow = ctx.createLinearGradient(x - 14, 0, x + 14, 0);
          glow.addColorStop(0, "rgba(251,191,36,0)");
          glow.addColorStop(0.5, "rgba(251,191,36,0.5)");
          glow.addColorStop(1, "rgba(251,191,36,0)");
          ctx.fillStyle = glow;
          ctx.fillRect(x - 14, 0, 28, ch);
          ctx.fillStyle = "#fbbf24";
          ctx.fillRect(x - 3, 0, 3, ch);
        }
      };

      /** The push: a slow camera move in, over the frame it replaces. */
      const push = (to: number, t: number): void => {
        ctx.clearRect(0, 0, cw, ch);
        if (backCtx) ctx.drawImage(back, 0, 0);
        const eased = 1 - (1 - t) * (1 - t);
        cover(ctx, to, 1.032 - 0.032 * eased, eased);
      };

      const run = (beat: number): void => {
        if (!live) return;
        if (beat >= BEATS.length) {
          // Out: the film dissolves into the sheet and the title assembles out of it.
          setOut(true);
          timer = window.setTimeout(call, OUT_MS);
          return;
        }
        const next = BEATS[beat];
        setStep(beat + 1);
        backCtx?.clearRect(0, 0, cw, ch);
        if (backCtx) cover(backCtx, beat === 0 ? next.cell : BEATS[beat - 1].cell);
        canvas.dataset.cell = String(next.cell);
        const started = performance.now();
        const move = (now: number): void => {
          if (!live) return;
          const t = Math.min(1, (now - started) / next.moveMs);
          if (next.move === "wipe") wipe(next.cell, t);
          else push(next.cell, t);
          if (t < 1) {
            frame = requestAnimationFrame(move);
            return;
          }
          timer = window.setTimeout(() => run(beat + 1), next.holdMs);
        };
        frame = requestAnimationFrame(move);
      };

      // The card holds for its beat, then the build starts. Under it the canvas is the sheet's ink.
      timer = window.setTimeout(() => run(0), CARD_MS);
    };

    return () => {
      live = false;
      window.clearTimeout(guard);
      window.clearTimeout(timer);
      cancelAnimationFrame(frame);
    };
  }, []);

  return (
    <figure className="entry-film-wrap" aria-hidden="true" data-out={out ? "yes" : "no"}>
      <canvas ref={ref} className="entry-film" data-testid="entry-film" />

      {/* The city's own card: the wordmark in the face the title will arrive in, its hairline drawn under it.
          DOM type, so it stays crisp at any resolution — the canvas is only for the pictures. */}
      <div className="entry-film-card" data-testid="entry-film-card" data-shown={step === 0 ? "yes" : "no"}>
        <span className="entry-film-mark">bahía rosa</span>
        <span className="entry-film-rule" />
      </div>

      <figcaption>
        <span className="entry-film-label">{step === 0 ? CARD_LABEL : (BEATS[step - 1]?.label ?? "")}</span>
        <span className="entry-film-step">
          {String(step + 1).padStart(2, "0")} / {STEPS}
        </span>
      </figcaption>
    </figure>
  );
}