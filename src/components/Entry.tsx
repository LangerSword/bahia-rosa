import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from "react";
import { motion } from "motion/react";
import { SCENE_IDS, sceneSrc } from "../look/scenes";
import { VapourText } from "./VapourText";
import "./entry.css";

/**
 * The way in.
 *
 * The reference for this was era-residence.com: a full-screen sheet with the brand assembled out of its
 * parts — where the paper is from, what it is called, what it is for — a counter ticking beside it, and
 * the sheet *lifting away* to the page rather than the page fading up behind it. What is ours rather
 * than theirs is what the counter counts: the four plates the picker draws from and the five faces the
 * page is set in, warmed while the title is up, so the counter is a real reading and the picker is
 * instant when the sheet goes. And the whole thing can be walked out of with any key, click or wheel,
 * because a title you cannot skip is a door held shut.
 *
 * It is skipped entirely for `prefers-reduced-motion`, for a session that has already seen it, and for
 * automation — see `src/lib/entry.ts`, which is where that decision lives so it can be tested.
 */

const EASE = [0.22, 1, 0.36, 1] as const;
const LIFT = [0.76, 0, 0.24, 1] as const;
/**
 * A title that flashes by is a glitch; the floor is what makes it read as a title.
 *
 * Two seconds, not one: the wordmark's own assembly (staggered letters, last one landing at ~1.3s) runs
 * inside this clock, so at 1.5s the sheet was lifting the instant the title finished — a title you never
 * get to read. Two seconds leaves about half a second where the assembled title is simply there.
 */
const FLOOR_MS = 2000;
/** …and a title that will not end is a hostage situation: the sheet lifts regardless of everything. */
const CEILING_MS = 4500;
const FACES = ["Limelight", "Poiret One", "Inter", "Pinyon Script", "Italianno"];

export function Entry({ onDone }: { onDone: () => void }): ReactElement {
  const [progress, setProgress] = useState(0);
  /**
   * The exit, in three parts. `hold` is the title being read; `vapour` is the wordmark turning to dust; and
   * `lift` is the sheet leaving. The dust comes *before* the lift rather than during it — the sheet waits
   * for the last particle, which is the reason the wordmark dissolves rather than simply fading with the
   * sheet it sits on.
   */
  const [phase, setPhase] = useState<"hold" | "vapour" | "lift">("hold");
  const leaving = phase === "lift";
  const finished = useRef(false);

  const plates = useMemo(() => SCENE_IDS.map((id) => sceneSrc(id)).filter(Boolean), []);
  const units = plates.length + 1;

  const finish = useCallback((): void => {
    if (finished.current) return;
    finished.current = true;
    onDone();
  }, [onDone]);

  /** The title has had its time: the wordmark turns to dust, and the lift waits for the last particle. */
  const leave = useCallback((): void => {
    setProgress(1);
    setPhase("vapour");
  }, []);

  /** Out, now. Skipping means skipping the dust too — a skip button that makes you watch is not a skip. */
  const skip = useCallback((): void => {
    setProgress(1);
    setPhase("lift");
  }, []);

  const wordmark = useRef<HTMLHeadingElement>(null);
  const [vapourBox, setVapourBox] = useState<{
    left: number;
    top: number;
    width: number;
    height: number;
    size: number;
  } | null>(null);

  /** Where the wordmark actually is, so the dust starts where the type was instead of near it. */
  useEffect(() => {
    if (phase !== "vapour") return;
    const node = wordmark.current;
    const sheet = node?.closest(".entry-sheet");
    if (!node || !(sheet instanceof HTMLElement)) return;
    const range = document.createRange();
    range.selectNodeContents(node);
    const type = range.getBoundingClientRect();
    const frame = sheet.getBoundingClientRect();
    setVapourBox({
      left: type.left - frame.left,
      top: type.top - frame.top,
      width: type.width,
      height: type.height,
      size: parseFloat(getComputedStyle(node).fontSize) || 96,
    });
  }, [phase]);

  /** The warm-up: the plates in parallel, the faces in one go, counted in units of work that happened. */
  useEffect(() => {
    let cancelled = false;
    let done = 0;
    const bump = (): void => {
      done += 1;
      if (!cancelled) setProgress(Math.min(1, done / units));
    };

    const fonts = Promise.all(FACES.map((face) => document.fonts.load(`1em "${face}"`)))
      .then(() => document.fonts.ready)
      .then(bump, bump);

    const warmPlates = plates.map((src) =>
      new Promise<void>((resolve) => {
        const image = new Image();
        image.decoding = "async";
        image.onload = () => resolve();
        image.onerror = () => resolve();
        image.src = src;
      }).then(bump),
    );

    /**
     * The clock for the lift starts at the first *painted* frame, not at mount.
     *
     * Measured, not assumed: this page spends its first second or so building a WebGL hero, and while the
     * main thread does that, the title's own animations have not started — so a floor measured from mount
     * lifted the sheet the instant the letters landed, and on a fast connection sometimes before they
     * did. Two frames is enough to know the browser is actually painting the sheet; from there, the floor
     * is time the visitor had the title in front of them.
     */
    const painted = new Promise<void>((resolve) => {
      if (typeof requestAnimationFrame !== "function") {
        resolve();
        return;
      }
      requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
    });
    const floor = painted.then(
      () =>
        new Promise<void>((resolve) => {
          window.setTimeout(resolve, FLOOR_MS);
        }),
    );

    void Promise.all([fonts, ...warmPlates]).then(async () => {
      await floor;
      if (!cancelled) leave();
    });

    const guard = window.setTimeout(() => {
      if (!cancelled) leave();
    }, CEILING_MS);

    return () => {
      cancelled = true;
      window.clearTimeout(guard);
    };
  }, [plates, units, leave]);

  /** Any key, any click, any wheel: out. */
  useEffect(() => {
    const bail = (): void => skip();
    window.addEventListener("keydown", bail);
    window.addEventListener("pointerdown", bail);
    window.addEventListener("wheel", bail, { passive: true });
    return () => {
      window.removeEventListener("keydown", bail);
      window.removeEventListener("pointerdown", bail);
      window.removeEventListener("wheel", bail);
    };
  }, [skip]);

  /** The page behind the sheet does not scroll while the sheet is up. */
  useEffect(() => {
    const root = document.documentElement;
    const before = root.style.overflow;
    root.style.overflow = "hidden";
    return () => {
      root.style.overflow = before;
    };
  }, []);

  /**
   * The lift's own callback is the normal ending, but a background tab pauses animation frames — and an
   * app left behind a sheet that stopped moving is worse than any title. So the ending also has a clock.
   */
  useEffect(() => {
    if (!leaving) return undefined;
    const safety = window.setTimeout(finish, 1400);
    return () => window.clearTimeout(safety);
  }, [leaving, finish]);

  return (
    <>
      {/* Two sheets, in sequence: the ink one, and the gold one a beat behind it — so the way out is the
          press's own hairline chasing the page into view, rather than a panel sliding off it. */}
      <motion.div
        className="entry-under"
        aria-hidden="true"
        initial={false}
        animate={leaving ? { y: "-101%" } : { y: 0 }}
        transition={{ duration: 0.85, ease: LIFT, delay: leaving ? 0.07 : 0 }}
      />
      <motion.div
        className="entry-sheet"
        data-testid="entry"
        aria-hidden="true"
        initial={false}
        animate={leaving ? { y: "-101%" } : { y: 0 }}
        transition={{ duration: 0.95, ease: LIFT }}
        onAnimationComplete={(): void => {
          if (leaving) finish();
        }}
      >
        <div className="entry-sheen" aria-hidden="true" />

        {/* The title, leaving as dust. The canvas is the size of the type itself, so the first particle
            appears where the first letter was. */}
        {phase === "vapour" && vapourBox ? (
          <div
            className="entry-vapour"
            style={{
              left: vapourBox.left,
              top: vapourBox.top,
              width: vapourBox.width,
              height: vapourBox.height,
            }}
          >
            <VapourText
              text="BAHÍA ROSA"
              font={{ family: "Limelight", size: vapourBox.size, weight: 400 }}
              color="#f2efe9"
              onDone={() => setPhase("lift")}
            />
          </div>
        ) : null}
        <div className="entry-top">
        <span className="kicker">la gaviota · the coast edition</span>
        <span className="entry-count" data-testid="entry-count">
          {String(Math.round(progress * 100)).padStart(3, "0")}
          <span className="entry-of"> / 100</span>
        </span>
      </div>

      <div className="entry-mid" />

      <div className="entry-block">
        <motion.p
          className="kicker entry-welcome"
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, ease: EASE, delay: 0.1 }}
        >
          welcome to
        </motion.p>
        <h1
          ref={wordmark}
          className="entry-wordmark"
          aria-label="welcome to bahía rosa"
          data-vapour={phase === "vapour" ? "on" : undefined}
        >
          {/* Letters, not a word: each one rises from behind its own baseline, in reading order. The mask
              is what makes it read as type being *set* rather than text fading in — the letter cannot be
              seen before its turn because there is nowhere for it to be seen from. */}
          {"BAHÍA ROSA".split("").map((letter, index) => (
            <span key={`${letter}-${index}`} className="entry-letter-mask" aria-hidden="true">
              <motion.span
                className="entry-letter"
                initial={{ y: 160 }}
                animate={{ y: 0 }}
                transition={{ duration: 0.9, ease: EASE, delay: 0.24 + index * 0.05 }}
              >
                {letter === " " ? "\u00A0" : letter}
              </motion.span>
            </span>
          ))}
        </h1>
        <motion.div
          className="entry-rule"
          initial={{ scaleX: 0 }}
          animate={{ scaleX: Math.max(0.02, progress) }}
          transition={{ duration: 0.5, ease: "easeOut" }}
        />
        <motion.p
          className="entry-deck"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.7, ease: EASE, delay: 0.75 }}
        >
          one photo. the city paints it, then runs it.
        </motion.p>
        <motion.p
          className="entry-trust"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.7, ease: EASE, delay: 0.95 }}
        >
          printed in your browser — no key, no account, no upload.
        </motion.p>
      </div>

      <div className="entry-foot">
        <span className="entry-warming">warming the press</span>
        <button type="button" className="entry-skip" data-testid="entry-skip" onClick={skip}>
          skip →
        </button>
      </div>
      </motion.div>
    </>
  );
}