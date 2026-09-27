import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from "react";
import { motion } from "motion/react";
import { SCENE_IDS, sceneSrc } from "../look/scenes";
import { markEntryPlayed } from "../lib/entry";
import { mergeLineRects } from "../lib/lines";
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
 *
 * **The letters do not appear until the display face has.** On a cold load the title's own animation used
 * to start on a clock, so the wordmark assembled in the *fallback* face and swapped to Limelight whenever
 * the font arrived — measured at ~1.1s in, with the face still absent — which is the "proper font takes
 * very long" glitch. The masks were already there; the letters now wait inside them, and the hold's clock
 * starts when the title is actually set rather than when the sheet arrived.
 */

const EASE = [0.22, 1, 0.36, 1] as const;
const LIFT = [0.76, 0, 0.24, 1] as const;
/**
 * A title that flashes by is a glitch; the floor is what makes it read as a title.
 *
 * Two seconds, not one: the wordmark's own assembly (staggered letters, last one landing at ~1.3s) runs
 * inside this clock, so at 1.5s the sheet was lifting the instant the title finished — a title you never
 * get to read. Four seconds is the welcome's own length — long enough that the assembled title, the signature
 * and the rule are a moment rather than a flash. The clock starts when the letters do, which is when the face
 * is ready.
 */
const FLOOR_MS = 4000;
/**
 * …and a title that will not end is a hostage situation: the sheet lifts regardless of everything. This is
 * the absolute guard, measured from mount, so a font that never arrives (a blocked CDN, a hostile network)
 * costs the visitor a few seconds of a counter and a skip button — never a stuck page. It has to clear the
 * film as well: the film is watched first, then the title's own floor runs, and a guard that fired between
 * the two would cut the title short on exactly the slow connection that needed the film skipped.
 */
const CEILING_MS = 15000;
/**
 * The gate's faces: the wordmark's and the signature's — the two the first paint depends on. (The body and
 * label faces swap in behind a title that is already being read, which is why they are not here.)
 */
const FACES = ["Limelight", "Italianno"];

export function Entry({ onDone }: { onDone: () => void }): ReactElement {
  /**
   * The welcome card's dwell — the only clock the card has. `?film=0` gives a probe the title without it, and
   * reduced motion gets no dwell at all: a pause invented to be looked at is exactly what that setting is
   * about. The card is the beginning of the show, not a video in front of it.
   */
  const welcomeMs = useMemo(() => {
    if (typeof window === "undefined") return 0;
    const skipped = new URLSearchParams(window.location.search).get("film") === "0";
    const calm =
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    return skipped || calm ? 0 : 900;
  }, []);
  const [progress, setProgress] = useState(0);
  /** The card, on stage before the title: the wordmark and the signature, held for as long as it is read. */
  const [welcome, setWelcome] = useState(welcomeMs > 0);
  /**
   * The exit, in three parts. `hold` is the title being read; `vapour` is the wordmark turning to dust; and
   * `lift` is the sheet leaving. The dust comes *before* the lift rather than during it — the sheet waits for
   * the last particle, which is the reason the wordmark dissolves rather than simply fading with the sheet.
   */
  const [phase, setPhase] = useState<"hold" | "vapour" | "lift">("hold");

  useEffect(() => {
    if (welcomeMs === 0) return;
    const timer = window.setTimeout(() => setWelcome(false), welcomeMs);
    return () => window.clearTimeout(timer);
  }, [welcomeMs]);

  
  const leaving = phase === "lift";
  const finished = useRef(false);
  const [faceReady, setFaceReady] = useState(false);
  const faceReadyRef = useRef(false);
  /**
   * The DOM letters stay hidden one beat *after* the dust begins, not at the same instant.
   *
   * The canvas paints the whole wordmark on its first frame and eats into it as the wave crosses, so for
   * those two or three frames the type exists twice — sampled on the canvas and set in the DOM. Cutting the
   * DOM copy at the same moment the phase flips left a hole where the canvas had not painted yet: the
   * un-dusted side of the wordmark simply missing for a frame or two. A beat of overlap is what makes it a
   * hand-off instead.
   */
  const [vapourSettled, setVapourSettled] = useState(false);

  const plates = useMemo(() => SCENE_IDS.map((id) => sceneSrc(id)).filter(Boolean), []);
  const units = plates.length + 1;

  /** The title has started in this page load; a remount must not start it again. */
  useEffect(() => {
    markEntryPlayed();
  }, []);

  const finish = useCallback((): void => {
    if (finished.current) return;
    finished.current = true;
    onDone();
  }, [onDone]);

  /**
   * The title has had its time: the wordmark turns to dust, and the lift waits for the last particle.
   *
   * Unless the face never arrived — then there is no set title to dissolve, and dust sampled from a
   * fallback face would be dust in the wrong shape. Skipping means skipping the dust, so it lifts.
   */
  const leave = useCallback((): void => {
    setProgress(1);
    setPhase(faceReadyRef.current ? "vapour" : "lift");
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
  /** The title's lines, measured off the DOM, so the dust is drawn in the shape the type actually has. */
  const [vapourLines, setVapourLines] = useState<ReturnType<typeof mergeLineRects>>([]);

  /**
   * The DOM letters stay hidden one beat *after* the dust begins, not at the same instant.
   *
   * The canvas paints the whole wordmark on its first frame and eats into it as the wave crosses, so for
   * those frames the type exists twice — sampled on the canvas and set in the DOM. Cutting the DOM copy at
   * the same moment the phase flips left a hole where the canvas had not painted yet: the un-dusted side of
   * the wordmark simply missing for a frame or two. A beat of overlap is what makes it a hand-off instead.
   *
   * Eight frames, not four: the canvas has to wait for its own face and one paint before it draws, and on a
   * loaded machine those frames are not cheap. The overlap costs nothing visible — both copies are the same
   * wordmark — and it is the difference between a hand-off and a flicker.
   */
  useEffect(() => {
    if (phase !== "vapour") {
      setVapourSettled(false);
      return undefined;
    }
    let frames = 0;
    let handle = 0;
    const step = (): void => {
      frames += 1;
      if (frames >= 8) {
        setVapourSettled(true);
        return;
      }
      handle = requestAnimationFrame(step);
    };
    handle = requestAnimationFrame(step);
    return () => cancelAnimationFrame(handle);
  }, [phase]);

  /** Where the wordmark actually is, and where its lines are, so the dust starts where the type was. */
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

    /**
     * The letters, grouped into lines.
     *
     * The wordmark is a wrapped `h1` — "BAHÍA ROSA" over two lines in its box — and a canvas that draws it as
     * one long line clips itself and changes the type's shape. So the lines are measured from the DOM (each
     * letter's own box, merged by line) and handed to the sampler, which draws them where they are.
     */
    const letters = [...node.querySelectorAll<HTMLElement>(".entry-letter")].map((element) => {
      const rect = element.getBoundingClientRect();
      return {
        text: element.textContent ?? "",
        left: rect.left - type.left,
        top: rect.top - type.top,
        width: rect.width,
        height: rect.height,
      };
    });
    setVapourLines(mergeLineRects(letters));
  }, [phase]);

  /** The warm-up: the plates in parallel, the faces in one go, counted in units of work that happened. */
  useEffect(() => {
    let cancelled = false;
    let done = 0;
    const bump = (): void => {
      done += 1;
      if (!cancelled) setProgress(Math.min(1, done / units));
    };

    const faceLanded = (): void => {
      if (cancelled) return;
      faceReadyRef.current = true;
      setFaceReady(true);
    };

    /**
     * The gate is the two faces the first paint depends on — the wordmark's and the signature's — not all
     * five: the body and label faces can swap in behind a title that is already being read, and waiting on
     * every file is what kept the wordmark behind its masks for as long as the slowest one took. And the
     * wait is capped, because a show that begins is worth more than a face that arrives.
     */
    const fonts = Promise.race([
      Promise.all(FACES.map((face) => document.fonts.load(`1em "${face}"`))).then(
        () => document.fonts.ready,
      ),
      new Promise<void>((resolve) => window.setTimeout(resolve, 2500)),
    ])
      // A face that cannot load must not hold the title hostage: the letters show in whatever the stack
      // gives, and the clock below still ends the sheet.
      .then(faceLanded, faceLanded)
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
     * is time the visitor had the title in front of them — and it begins once the face has landed, so it is
     * time the visitor had the *set* title, not the fallback.
     */
    const painted = new Promise<void>((resolve) => {
      if (typeof requestAnimationFrame !== "function") {
        resolve();
        return;
      }
      requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
    });
    // The film, if it is playing, is part of the wait: the floor below is time the *title* had in front of
    // the visitor, and the film is not the title. When the film is skipped the gate is already resolved.
    const floor = Promise.all([fonts, painted]).then(
      () =>
        new Promise<void>((resolve) => {
          window.setTimeout(resolve, FLOOR_MS);
        }),
    );

    void Promise.all([floor, ...warmPlates]).then(() => {
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

  /** Any key, any click, any wheel: out. The music is the app's now and plays on; this only ends the sheet. */
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
        data-phase={phase}
        data-face={faceReady ? "ready" : "waiting"}
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
              lines={vapourLines}
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
          a character debut, in one photograph
        </motion.p>
        <h1
          ref={wordmark}
          className="entry-wordmark"
          aria-label="welcome to bahía rosa"
          data-vapour={phase === "hold" || !vapourSettled ? undefined : "on"}
        >
          {/* Letters, not a word: each one rises from behind its own baseline, in reading order. The mask
              is what makes it read as type being *set* rather than text fading in — the letter cannot be
              seen before its turn because there is nowhere for it to be seen from. And the turn does not
              come until the face has: a wordmark assembled in the fallback and swapped later is a glitch,
              which is exactly what this waits out. The film is the other half of that wait: letters that
              rose while the press was still showing would have assembled behind a picture. */}
          {"BAHÍA ROSA".split("").map((letter, index) => (
            <span key={`${letter}-${index}`} className="entry-letter-mask" aria-hidden="true">
              <motion.span
                className="entry-letter"
                initial={{ y: 160 }}
                animate={faceReady && !welcome ? { y: 0 } : { y: 160 }}
                transition={{ duration: 0.9, ease: EASE, delay: 0.24 + index * 0.05 }}
              >
                {letter === " " ? "\u00A0" : letter}
              </motion.span>
            </span>
          ))}
          {/* One wordmark, one credit: the signature rides inside the title so there is exactly one "bahía rosa"
              on the sheet, and the vapour takes the credit with the letters instead of leaving a mark behind. */}
          <span className="entry-film-by" data-testid="entry-card-by">by langersword</span>
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