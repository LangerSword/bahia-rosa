import { useEffect, useMemo, useRef, useState } from "react";
import { tearPath, TEAR_WIDTH } from "../lib/tear";

/**
 * Your photo, and what the city did to it.
 *
 * The whole product is this one transformation, so it should be visible rather than implied: the original
 * on the left, the pressed plate on the right, and the seam between them is a *tear*. A ruler-straight
 * divider reads like a slider widget; a torn edge reads like paper — the plate was torn away from the
 * photograph, and the visitor is holding the tear.
 *
 * The handle is still a range input underneath, so this stays keyboard-operable and readable by a screen
 * reader instead of being a div that happens to follow a mouse.
 */
export function BeforeAfter({ before, after }: { before: string; after: string }) {
  const [split, setSplit] = useState(52);
  const [beforeLoaded, setBeforeLoaded] = useState(false);
  const frame = useRef<HTMLDivElement>(null);

  // One tear shape per comparison, computed once: the same seed draws the same tear every render, so the
  // edge never flickers while the handle moves.
  const tear = useMemo(() => tearPath(42, 100), []);

  useEffect(() => {
    setBeforeLoaded(false);
  }, [before]);

  return (
    <div className="mt-6" data-testid="before-after">
      <div className="flex items-baseline justify-between gap-4">
        <span className="kicker">Your photo → the plate</span>
        <span className="kicker" style={{ color: "var(--color-muted)" }}>
          drag the tear
        </span>
      </div>

      <div
        ref={frame}
        className="plinth rule relative mt-3 overflow-hidden border"
        style={{ aspectRatio: "16 / 9" }}
      >
        {/* The plate fills the frame; the original is clipped over it, so the reveal is one number. */}
        <img
          src={after}
          alt="The plate the city printed from your photo"
          className="absolute inset-0 h-full w-full object-contain"
          style={{ background: "var(--color-ink)" }}
        />
        <div className="absolute inset-0 overflow-hidden" style={{ width: `${split}%` }}>
          <img
            src={before}
            alt="Your original photo"
            onLoad={() => setBeforeLoaded(true)}
            className="h-full w-full object-contain"
            style={{ width: frame.current ? `${frame.current.clientWidth}px` : "100%", maxWidth: "none", background: "var(--color-ink)" }}
          />
        </div>

        {/* The tear: the seam itself, drawn as paper rather than ruled as a line. It carries a shadow on the
            original's side, because the original is the sheet that was lifted away. */}
        <svg
          aria-hidden="true"
          data-testid="tear-edge"
          viewBox={`0 0 ${TEAR_WIDTH} 100`}
          preserveAspectRatio="none"
          className="pointer-events-none absolute inset-y-0"
          style={{
            left: `${split}%`,
            width: TEAR_WIDTH,
            height: "100%",
            transform: `translateX(${-TEAR_WIDTH / 2}px)`,
            filter: "drop-shadow(-5px 0 7px rgba(0, 0, 0, 0.75))",
          }}
        >
          <path
            d={tear}
            fill="none"
            stroke="var(--color-gold)"
            strokeWidth={1.4}
            strokeLinejoin="round"
            vectorEffect="non-scaling-stroke"
          />
        </svg>
      </div>

      <label className="mt-3 block">
        <span className="sr-only">How much of the original to show</span>
        <input
          type="range"
          min={0}
          max={100}
          value={split}
          data-testid="before-after-handle"
          onChange={(event) => setSplit(Number(event.target.value))}
          className="w-full accent-[color:var(--color-gold)]"
        />
      </label>
      {beforeLoaded ? null : (
        <p className="kicker mt-1" style={{ color: "var(--color-muted)" }}>
          loading the original…
        </p>
      )}
    </div>
  );
}