import type { ReactElement, ReactNode } from "react";
import { motion } from "motion/react";
import "./tile.css";

/**
 * A choice, at the standard of the plates.
 *
 * The hour, the place and the finish were three different-looking rows of buttons — one with a graded
 * thumbnail, one with a thumbnail and a different caption colour, one with nothing but two words in a box.
 * They are all the same act: choosing one thing over its neighbours. So they are the same object now, built
 * from the same parts as the contact sheet on this page: a mat, a hairline, a caption in the open, and one
 * gold mark for the chosen state — a mark that *travels* between neighbours rather than being redrawn at
 * each stop, which is the device the press's step rail already uses.
 *
 * A magnet, too, so the ring leans toward it on devices that have one.
 */

export function Tile({
  active,
  testId,
  onClick,
  onHover,
  role,
  media,
  label,
  note,
  dots,
  index,
  className,
}: {
  active: boolean;
  testId: string;
  onClick: () => void;
  onHover?: () => void;
  /** Passed through for the finish row, which is a radiogroup rather than a set of pressed buttons. */
  role?: "radio";
  /** A thumbnail or swatch: whatever shows this choice before it is made. */
  media?: ReactNode;
  label: string;
  /** One true line about the choice. Specs, not adjectives. */
  note?: string;
  /** Which group this tile belongs to — the travelling mark is scoped per group, not across the page. */
  dots: string;
  index?: number;
  className?: string;
}): ReactElement {
  return (
    <motion.button
      type="button"
      role={role}
      data-testid={testId}
      data-magnet={`tile-${dots}`}
      aria-checked={role === "radio" ? active : undefined}
      aria-pressed={role === "radio" ? undefined : active}
      onClick={onClick}
      onPointerEnter={onHover}
      className={`tile lift w-full text-left sm:w-auto ${className ?? ""}`}
      data-active={active ? "yes" : "no"}
      transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
    >
      {media ? <span className="tile-media">{media}</span> : null}
      <span className="tile-caption">
        <span className="tile-label">
          {/* The chosen mark travels between neighbours: one ink dot, moved by motion, not one per tile. */}
          {active ? (
            <motion.span layoutId={`tile-dot-${dots}`} className="tile-dot" aria-hidden="true" />
          ) : (
            <span className="tile-dot tile-dot-quiet" aria-hidden="true" />
          )}
          {label}
        </span>
        {note ? <span className="tile-note">{note}</span> : null}
      </span>
      {typeof index === "number" ? <span className="tile-index">{String(index + 1).padStart(2, "0")}</span> : null}
    </motion.button>
  );
}