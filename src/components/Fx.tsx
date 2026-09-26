import { type ReactNode } from "react";
import {
  motion,
  useReducedMotion,
  useScroll,
  useSpring,
  useTransform,
  useVelocity,
  type MotionValue,
} from "motion/react";
import "./effects.css";

/**
 * The site's atmosphere, in one place.
 *
 * The brief was "add effect to the entire site", and the honest reading of that is not a different
 * animation per section — it is one continuous surface: a photographic grain over the whole page, a
 * vignette pulling the eye to the middle, a sheen that rolls down once as the edition goes to press,
 * a progress hairline under the masthead, and reveals that fire when a section arrives rather than
 * when the page loads. All of it is decoration: none of it is in the accessibility tree, all of it
 * stops for `prefers-reduced-motion`.
 */

export function Fx(): ReactNode {
  const reduce = useReducedMotion();
  return (
    <>
      {/* Below the content and above the background: grain reads as film, not as a dirty screen. */}
      <div className="fx-grain" aria-hidden="true" />
      <div className="fx-vignette" aria-hidden="true" />
      {reduce ? null : <div className="fx-roll" aria-hidden="true" />}
      {reduce ? null : <ScrollProgress />}
    </>
  );
}

/** The hairline under the masthead: how far through the edition you are. */
export function ScrollProgress(): ReactNode {
  const { scrollYProgress } = useScroll();
  const width = useSpring(scrollYProgress, { stiffness: 120, damping: 26, restDelta: 0.001 });
  return (
    <div className="fx-progress" aria-hidden="true">
      <motion.div className="fx-progress-fill" style={{ scaleX: width }} />
    </div>
  );
}

/**
 * A section that arrives. `whileInView` with `once` — a section that re-animates every time it scrolls
 * back into view is a section that gets in the way of reading it.
 */
export function Reveal({
  children,
  className,
  delay = 0,
  testId,
}: {
  children: ReactNode;
  className?: string;
  delay?: number;
  testId?: string;
}): ReactNode {
  const reduce = useReducedMotion();
  if (reduce) {
    return (
      <div className={className} data-testid={testId}>
        {children}
      </div>
    );
  }
  return (
    <motion.div
      className={className}
      data-testid={testId}
      initial={{ opacity: 0, y: 18 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-80px" }}
      transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1], delay }}
    >
      {children}
    </motion.div>
  );
}

/**
 * The department strapline that separates stages. Long enough to actually scroll, because a marquee
 * that finishes before you notice it is a marquee nobody saw — and it leans into a flick: the faster the
 * page is moving when it comes into view, the more the type skews, settling back as you stop. That is a
 * reading of `scrollY`'s own velocity, so it is genuinely the visitor's hand on the page and not a loop.
 */
export function Marquee({ items }: { items: string[] }): ReactNode {
  const reduce = useReducedMotion();
  const row = [...items, ...items, ...items];
  const skew = useScrollSkew();
  return (
    <div className="fx-marquee rule border-y py-3" aria-hidden="true">
      <motion.div
        className={reduce ? "fx-marquee-row fx-marquee-still" : "fx-marquee-row"}
        style={reduce ? undefined : { skewY: skew }}
      >
        {row.map((item, index) => (
          <span key={`${item}-${index}`} className="kicker mx-6">
            {item} <span style={{ color: "var(--color-gold)" }}>·</span>
          </span>
        ))}
      </motion.div>
    </div>
  );
}

/** How fast the page is moving, as a small skew: a few degrees at most, clamped, and sprung so it settles. */
function useScrollSkew(): MotionValue<number> {
  const { scrollY } = useScroll();
  const velocity = useVelocity(scrollY);
  const smooth = useSpring(velocity, { stiffness: 130, damping: 28, restDelta: 1 });
  return useTransform(smooth, [-2200, 0, 2200], [-3.4, 0, 3.4], { clamp: true });
}