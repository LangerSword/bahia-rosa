import { useEffect, useRef, useState } from "react";

/**
 * Your photo, and what the city did to it.
 *
 * The whole product is this one transformation, so it should be visible rather than implied: the
 * original on the left, the pressed plate on the right, one handle between them. The handle is a
 * range input, so it is keyboard-operable and readable by a screen reader instead of being a div that
 * happens to follow a mouse.
 */
export function BeforeAfter({ before, after }: { before: string; after: string }) {
  const [split, setSplit] = useState(52);
  const [beforeLoaded, setBeforeLoaded] = useState(false);
  const frame = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setBeforeLoaded(false);
  }, [before]);

  return (
    <div className="mt-6" data-testid="before-after">
      <div className="flex items-baseline justify-between gap-4">
        <span className="kicker">Your photo → the plate</span>
        <span className="kicker" style={{ color: "var(--color-muted)" }}>
          drag the handle
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
        <div
          aria-hidden="true"
          className="absolute inset-y-0"
          style={{ left: `${split}%`, width: 2, background: "var(--color-gold)", opacity: 0.9 }}
        />
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
