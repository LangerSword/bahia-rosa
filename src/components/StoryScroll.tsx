import { useRef, useState, type ReactElement } from "react";
import {
  motion,
  useMotionValueEvent,
  useReducedMotion,
  useScroll,
  useSpring,
  useTransform,
  type MotionValue,
} from "motion/react";
import { STORY_LEAD, STORY_TAIL, storyAt, storyMoments, type StoryMoment, type StoryImages } from "../lib/story";
import "./story.css";

/**
 * The story, told by scrolling: the photograph, the plate, and the city it was printed into.
 *
 * Three of the visitor's own artefacts, stacked in one pinned room. Each panel rises as the previous one
 * recedes — the motion is the meaning, the way a story advances — and the rail on the left carries one ink
 * mark that travels between the three names, the same device the press uses for its stages.
 *
 * Deliberately the *opposite* of the reference here: the scroll is never taken away. The section is a
 * little over two screens tall, the panels cross over within it, and the page keeps moving at whatever
 * speed the visitor chose. Under reduced motion the three moments are simply three stacked figures with
 * their write-ups — the story is in the order, not in the motion.
 */
export function StoryScroll({ images }: { images: StoryImages }): ReactElement {
  const reduce = useReducedMotion();
  const moments = storyMoments(images);
  const section = useRef<HTMLElement>(null);

  const { scrollYProgress } = useScroll({ target: section, offset: ["start end", "end start"] });
  const progress = useSpring(scrollYProgress, { stiffness: 130, damping: 28, mass: 0.35 });

  // The walk itself is `storyAt`'s job, and it is reported on the section so the state of the story is a
  // fact a test can read rather than a claim in a comment.
  const [active, setActive] = useState(0);
  useMotionValueEvent(scrollYProgress, "change", (value) => {
    const { index } = storyAt(value, moments.length);
    setActive((current) => (current === index ? current : index));
  });

  return (
    <section
      ref={section}
      className="story"
      data-motion={reduce ? "still" : "walk"}
      data-active-moment={moments[active]?.id ?? moments[0].id}
      aria-labelledby="story-heading"
    >
      <div className="story-intro">
        <h2 id="story-heading" className="display text-2xl sm:text-3xl">
          what happened to it
        </h2>
        <p className="measure mt-2 text-xs" style={{ color: "var(--color-muted)" }}>
          Three moments, all of them yours: what you brought, what the press made of it, and where it was
          printed. Scroll.
        </p>
      </div>

      <div className="story-stage">
        <ol className="story-rail" aria-label="The three moments">
          {moments.map((moment, index) => (
            <RailName key={moment.id} moment={moment} index={index} progress={progress} reduce={Boolean(reduce)} />
          ))}
        </ol>

        <div className="story-room">
          {moments.map((moment, index) => (
            <StoryPanel
              key={moment.id}
              moment={moment}
              index={index}
              count={moments.length}
              progress={progress}
              reduce={Boolean(reduce)}
            />
          ))}
        </div>
      </div>
    </section>
  );
}

/** One name on the rail. The ink mark that travels is this list's shared layout — no extra machinery. */
function RailName({
  moment,
  index,
  progress,
  reduce,
}: {
  moment: StoryMoment;
  index: number;
  progress: MotionValue<number>;
  reduce: boolean;
}): ReactElement {
  const middle = (index + 0.5) / 3;
  const lit = useTransform(progress, [middle - 0.16, middle - 0.04], [0.42, 1]);

  return (
    <li className="story-rail-name" data-moment={moment.id}>
      <motion.span style={reduce ? undefined : { opacity: lit }} className="story-rail-label">
        {moment.label}
      </motion.span>
      <span className="story-rail-dot" aria-hidden="true" />
    </li>
  );
}

/**
 * One moment, in the room.
 *
 * The window is the *same* window `storyAt` walks — the story's own lead and tail, divided by three — and
 * that is the point: a first cut gave each panel its own arbitrary slice of raw scroll progress, so the
 * panel was fully visible for a single instant and spent the rest of its moment fading, which read as an
 * empty room. Here a moment fades in over the first fifth of its own stretch, holds at full for the middle,
 * and leaves over the last fifth, so the moment reported as active is the moment actually on screen.
 */
function StoryPanel({
  moment,
  index,
  count,
  progress,
  reduce,
}: {
  moment: StoryMoment;
  index: number;
  count: number;
  progress: MotionValue<number>;
  reduce: boolean;
}): ReactElement {
  const slot = (STORY_TAIL - STORY_LEAD) / count;
  const start = STORY_LEAD + index * slot;
  const end = start + slot;
  const inAt = start + slot * 0.18;
  const outAt = end - slot * 0.18;

  const rise = useTransform(progress, [start, end], [40, -40]);
  const fade = useTransform(progress, [start, inAt, outAt, end], [0, 1, 1, 0]);
  const depth = useTransform(progress, [start, end], [0.95, 1.03]);
  const tilt = useTransform(progress, [start, end], [1.4, -1.4]);

  return (
    <motion.figure
      className="story-panel"
      data-moment={moment.id}
      style={reduce ? undefined : { opacity: fade, y: rise, scale: depth, rotate: tilt }}
    >
      <img src={moment.src} alt={moment.alt} loading="lazy" decoding="async" />
      <figcaption className="story-caption">
        <span className="kicker" style={{ color: "var(--color-gold)" }}>
          {moment.label}
        </span>
        <span className="story-note">{moment.note}</span>
      </figcaption>
    </motion.figure>
  );
}