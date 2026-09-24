import { useEffect, useRef, type ReactElement } from "react";
import { gradeFor, gradePixels } from "../look/timeofday";
import { sceneSrc, type SceneId } from "../look/scenes";

/**
 * A place at an hour.
 *
 * The look picker used to be four words in boxes, so choosing "Neon" changed a caption and nothing a
 * visitor could see — the complaint that the time of day did not work. This draws the *scene* through
 * the same grade the press uses, so the choice shows itself before anyone commits a photograph to it.
 * Same code path as the composite: if the thumbnail and the printed frame disagree, that is a bug.
 */

export function SceneThumb({
  scene,
  look,
  width = 208,
  height = 117,
  className,
  testId,
}: {
  scene: SceneId;
  look: string;
  width?: number;
  height?: number;
  className?: string;
  testId?: string;
}): ReactElement {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    let live = true;
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const image = new Image();
    image.decoding = "async";
    image.src = sceneSrc(scene);
    void image
      .decode()
      .then(() => {
        if (!live) return;
        canvas.width = width;
        canvas.height = height;
        const scale = Math.max(width / image.width, height / image.height);
        ctx.drawImage(
          image,
          (width - image.width * scale) / 2,
          (height - image.height * scale) / 2,
          image.width * scale,
          image.height * scale,
        );
        const pixels = ctx.getImageData(0, 0, width, height);
        pixels.data.set(gradePixels(pixels.data, gradeFor(look)));
        ctx.putImageData(pixels, 0, 0);
      })
      .catch(() => undefined);

    return () => {
      live = false;
    };
  }, [scene, look, width, height]);

  return (
    <canvas
      ref={ref}
      width={width}
      height={height}
      className={className}
      data-testid={testId}
      aria-hidden="true"
      style={{ display: "block", background: "#000" }}
    />
  );
}