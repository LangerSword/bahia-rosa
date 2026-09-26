import { useEffect, useMemo, useRef, useState, type ReactElement } from "react";
import { motion, useReducedMotion, useScroll, useSpring, useTransform, type MotionValue } from "motion/react";
import { GALLERY, splitColumns, type GalleryFrame } from "../lib/gallery";
import "./plate-gallery.css";

/**
 * The plates, unfurling.
 *
 * The structure is the 3D parallax unfurling gallery from 21st.dev — a wall of frames that stands up as you
 * scroll past it, columns drifting at different rates — and the content is ours: nine frames the app
 * actually produced. Two things are deliberately different from the reference:
 *
 *   **nothing is hijacked.** The reference pins the wall for six hundred viewport-heights. This one is a
 *   sticky panel inside a section barely twice the viewport, so the unfurl happens *beside* the visitor's
 *   reading rather than instead of it, and the rest of the page is reachable at the scroll speed they chose.
 *
 *   **the plates stay legible.** A gallery of proofs that damages the proofs is a failed gallery: the wall
 *   settles close to flat (a few degrees, not forty-five), the frames keep their own aspect ratio, and the
 *   offset never grows past a corner of the frame.
 *
 * Under `prefers-reduced-motion` the wall is a plain grid — no transforms, no sticky — and on a phone it
 * deals into two columns with the drift halved.
 */

const CARD_COLUMNS = 3;
const PHONE_COLUMNS = 2;

export function PlateGallery(): ReactElement {
  const reduce = useReducedMotion();
  const section = useRef<HTMLElement>(null);
  const [columns, setColumns] = useState(CARD_COLUMNS);

  /** Columns by capability, not by user-agent: three where there is room, two where there is not. */
  useEffect(() => {
    if (typeof window.matchMedia !== "function") return undefined;
    const query = window.matchMedia("(max-width: 640px)");
    const update = (): void => setColumns(query.matches ? PHONE_COLUMNS : CARD_COLUMNS);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);

  const dealt = useMemo(() => splitColumns(GALLERY, columns), [columns]);

  const { scrollYProgress } = useScroll({
    target: section,
    offset: ["start end", "end start"],
  });
  const progress = useSpring(scrollYProgress, { stiffness: 120, damping: 26, mass: 0.4 });

  // From a wall standing away from you to a wall you are reading: every value ends near flat, and the
  // starting tilt is kept shallow enough that the near edge cannot grow out of its box.
  const rotateY = useTransform(progress, [0, 1], [-18, -2.5]);
  const rotateX = useTransform(progress, [0, 1], [12, 2]);
  const rotateZ = useTransform(progress, [0, 1], [5, 0.6]);
  const depth = useTransform(progress, [0, 1], [-300, 0]);
  const scale = useTransform(progress, [0, 1], [0.96, 1]);

  return (
    <section
      ref={section}
      className="plate-gallery"
      data-motion={reduce ? "still" : "unfurl"}
      data-columns={columns}
      aria-labelledby="plates-heading"
    >
      <div className="plate-gallery-intro">
        <h2 id="plates-heading" className="display text-2xl sm:text-3xl">
          the plates
        </h2>
        <p className="measure mt-2 text-xs" style={{ color: "var(--color-muted)" }}>
          Nine frames, every one of them printed by this press: photographed people and the places they were
          printed into. No stock photography, no gallery of someone else&rsquo;s pictures.
        </p>
      </div>

      <div className="plate-gallery-stage">
        <motion.div
          className="plate-gallery-wall"
          style={
            reduce
              ? undefined
              : { rotateX, rotateY, rotateZ, z: depth, scale, transformStyle: "preserve-3d" }
          }
        >
          {dealt.map((column, columnIndex) => (
            <GalleryColumn
              key={`column-${columnIndex}`}
              frames={column}
              index={columnIndex}
              progress={progress}
              reduce={Boolean(reduce)}
            />
          ))}
        </motion.div>
      </div>
    </section>
  );
}

/**
 * One column of the wall. Its own component on purpose: a hook may not be called inside a map, and the
 * column count changes between three and two as the viewport crosses 640px.
 */
function GalleryColumn({
  frames,
  index,
  progress,
  reduce,
}: {
  frames: GalleryFrame[];
  index: number;
  progress: MotionValue<number>;
  reduce: boolean;
}): ReactElement {
  // The drift is what stops it reading as a rigid grid: neighbours never move together.
  const y = useTransform(progress, [0, 1], index % 2 === 0 ? ["4%", "-7%"] : ["-3%", "3%"]);

  return (
    <motion.div
      className="plate-gallery-column"
      data-column={index}
      style={reduce ? undefined : { y }}
    >
      {frames.map((frame) => (
        <Frame key={frame.src} frame={frame} />
      ))}
    </motion.div>
  );
}

function Frame({ frame }: { frame: GalleryFrame }): ReactElement {
  const [loaded, setLoaded] = useState(false);

  return (
    <figure className="plate-frame" data-loaded={loaded ? "yes" : "no"}>
      <img
        src={frame.src}
        alt={frame.caption}
        width={frame.width}
        height={frame.height}
        loading="lazy"
        decoding="async"
        onLoad={() => setLoaded(true)}
        onError={() => setLoaded(true)}
      />
      <figcaption className="plate-frame-caption">{frame.caption}</figcaption>
    </figure>
  );
}