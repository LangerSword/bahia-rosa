import { useEffect, useState, type ReactElement } from "react";
import { useReducedMotion } from "motion/react";
import { PRESS_TIPS } from "../lib/tips";
import "./press.css";

/**
 * What the press says while it works.
 *
 * A loading screen gives you something to read while you wait — that is the whole convention, and the
 * honest version of it is one *true* sentence at a time rather than a spinner with a slogan under it. The
 * tips rotate; under `prefers-reduced-motion` the first one simply stays.
 */
export function PressTips(): ReactElement {
  const reduce = useReducedMotion();
  const [index, setIndex] = useState(0);

  useEffect(() => {
    if (reduce) return undefined;
    const timer = window.setInterval(() => setIndex((current) => (current + 1) % PRESS_TIPS.length), 4600);
    return () => window.clearInterval(timer);
  }, [reduce]);

  return (
    <p className="press-tip mt-4" data-testid="press-tip" key={index}>
      {PRESS_TIPS[index]}
    </p>
  );
}