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
    const src = sceneSrc(scene);
    if (!src) {
      // A scene with no plate: the ground is the visitor's own photograph, which does not exist yet at the
      // moment they choose it. So the thumbnail is a *drawing* of what the choice means — a room of one's
      // own, lit — rather than a title card with words on it. The words were the first attempt and they read
      // as a placeholder, which is exactly what a choice should never look like.
      const wall = ctx.createLinearGradient(0, 0, 0, height);
      wall.addColorStop(0, "#241a2e");
      wall.addColorStop(1, "#150f1d");
      ctx.fillStyle = wall;
      ctx.fillRect(0, 0, width, height);

      ctx.fillStyle = "#1c1526";
      ctx.fillRect(0, height * 0.72, width, height * 0.28);
      ctx.strokeStyle = "rgba(244, 233, 216, 0.14)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, height * 0.72);
      ctx.lineTo(width, height * 0.72);
      ctx.stroke();

      // A window, and the light it throws across the floor.
      const wx = width * 0.58;
      const wy = height * 0.14;
      const ww = width * 0.28;
      const wh = height * 0.44;
      const daylight = ctx.createLinearGradient(wx, wy, wx, wy + wh);
      daylight.addColorStop(0, "#f3d095");
      daylight.addColorStop(1, "#c98f5e");
      ctx.fillStyle = daylight;
      ctx.fillRect(wx, wy, ww, wh);
      ctx.strokeStyle = "rgba(20, 15, 28, 0.85)";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(wx + ww / 2, wy);
      ctx.lineTo(wx + ww / 2, wy + wh);
      ctx.moveTo(wx, wy + wh / 2);
      ctx.lineTo(wx + ww, wy + wh / 2);
      ctx.stroke();
      ctx.fillStyle = "rgba(243, 208, 149, 0.16)";
      ctx.beginPath();
      ctx.moveTo(wx, wy + wh);
      ctx.lineTo(wx + ww, wy + wh);
      ctx.lineTo(wx + ww * 1.6, height);
      ctx.lineTo(wx - ww * 0.4, height);
      ctx.closePath();
      ctx.fill();

      // Somebody standing in their own room, before the city gets hold of them.
      const fx = width * 0.28;
      const fw = width * 0.11;
      const fh = height * 0.42;
      const fy = height * 0.72 - fh;
      ctx.fillStyle = "#0d0912";
      ctx.beginPath();
      ctx.ellipse(fx + fw / 2, fy - fw * 0.3, fw * 0.42, fw * 0.5, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillRect(fx, fy, fw, fh);

      const vignette = ctx.createRadialGradient(
        width / 2,
        height / 2,
        Math.min(width, height) * 0.2,
        width / 2,
        height / 2,
        Math.max(width, height) * 0.72,
      );
      vignette.addColorStop(0, "rgba(0, 0, 0, 0)");
      vignette.addColorStop(1, "rgba(0, 0, 0, 0.5)");
      ctx.fillStyle = vignette;
      ctx.fillRect(0, 0, width, height);
      return;
    }
    image.src = src;
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
      style={{ display: "block", background: "#150f1d" }}
    />
  );
}