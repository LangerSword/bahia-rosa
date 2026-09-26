import { useEffect, useRef, type ReactElement } from "react";

/**
 * Type that turns to dust.
 *
 * The mechanic is from the vapour-text component on 21st.dev, rebuilt for this site: the text is rendered
 * once to a canvas, sampled into a particle per few pixels, and a wave sweeps across it — every particle the
 * wave reaches takes a velocity, damps toward rest, and fades. Roughly two thousand specks, a second of it,
 * and the wordmark is gone.
 *
 * Two faults of the first cut are fixed here, and both were *alignment*:
 *
 *   the dust was sampled centred in the box the DOM text occupied with no margin, so it sat a hair off the
 *   letters it replaced and an accented Í could have its accent cut by the canvas edge. The canvas is now
 *   that box *plus a margin*, offset negatively, with the type drawn into the middle of the padded canvas:
 *   nothing clips, and the first sample lands where the first letter was.
 *
 *   the sampled width was whatever the canvas measured, while the DOM text carries `letter-spacing`. The two
 *   are reconciled — the font is scaled by the ratio between them — because dust that does not start on its
 *   own lettering reads as a glitch rather than as type coming apart.
 *
 * Three things are deliberately *not* carried over, because they are about a component library rather than
 * about this page: it renders at device-pixel-ratio 1 (the visitor's machine is running the press, and dust
 * does not need retina), it never runs under `prefers-reduced-motion` (it reports done immediately, so the
 * sheet lifts as it always has for those visitors), and it **reports when it is finished** — the sheet's
 * lift waits for the last particle rather than racing it.
 */

interface VapourTextProps {
  text: string;
  font: { family: string; size: number; weight?: number };
  color: string;
  /** Seconds for the wave to cross the text. */
  duration?: number;
  /** 0–1: how many particles spend themselves quickly rather than drifting. */
  density?: number;
  /** How far a particle travels from where it was, in pixels. */
  spread?: number;
  onDone: () => void;
}

interface Particle {
  x: number;
  y: number;
  homeX: number;
  homeY: number;
  velocityX: number;
  velocityY: number;
  opacity: number;
  fadeQuickly: boolean;
}

export function VapourText({
  text,
  font,
  color,
  duration = 1.05,
  density = 0.72,
  spread = 46,
  onDone,
}: VapourTextProps): ReactElement {
  const host = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const done = useRef(false);

  useEffect(() => {
    const node = host.current;
    const surface = canvas.current;
    if (!node || !surface) return undefined;

    const finish = (): void => {
      if (!done.current) {
        done.current = true;
        onDone();
      }
    };

    const reduce =
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce) {
      finish();
      return undefined;
    }

    let raf = 0;
    let cancelled = false;

    /**
     * Wait for the face to actually be there, and for one frame, so the host has its final size. Sampling
     * before either lands is how dust ends up in the wrong font — which is the same as in the wrong place.
     */
    const start = async (): Promise<void> => {
      await document.fonts.load(`${font.size}px "${font.family}"`).catch(() => undefined);
      await document.fonts.ready.catch(() => undefined);
      if (cancelled || !node.isConnected) return;
      await new Promise<void>((resolve) => {
        raf = requestAnimationFrame(() => resolve());
      });
      if (cancelled) return;

      const ctx = surface.getContext("2d");
      if (!ctx) {
        finish();
        return;
      }

      const boxWidth = Math.max(1, Math.round(node.clientWidth));
      const boxHeight = Math.max(1, Math.round(node.clientHeight));

      // Room around the type: an accent above and a tail below both need somewhere to be, and dust that
      // starts outside the canvas is dust that never existed.
      const pad = Math.round(font.size * 0.45);
      const width = boxWidth + pad * 2;
      const height = boxHeight + pad * 2;
      surface.width = width;
      surface.height = height;
      surface.style.width = `${width}px`;
      surface.style.height = `${height}px`;
      surface.style.left = `${-pad}px`;
      surface.style.top = `${-pad}px`;

      // Reconcile the canvas's idea of the word with the DOM's, which carries letter-spacing.
      const size0 = Math.max(8, Math.round(font.size));
      ctx.font = `${font.weight ?? 400} ${size0}px ${font.family}`;
      const measured = ctx.measureText(text).width || 1;
      const fit = Math.min(1.08, Math.max(0.92, boxWidth / measured));
      const size = Math.max(8, Math.round(size0 * fit));

      ctx.font = `${font.weight ?? 400} ${size}px ${font.family}`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.imageSmoothingEnabled = true;
      ctx.fillStyle = color;
      ctx.fillText(text, width / 2, height / 2);

      const image = ctx.getImageData(0, 0, width, height).data;
      ctx.clearRect(0, 0, width, height);

      const step = Math.max(2, Math.round(size / 34));
      const particles: Particle[] = [];
      for (let y = 0; y < height; y += step) {
        for (let x = 0; x < width; x += step) {
          const alpha = image[(y * width + x) * 4 + 3];
          if (alpha > 24) {
            particles.push({
              x,
              y,
              homeX: x,
              homeY: y,
              velocityX: 0,
              velocityY: 0,
              opacity: (alpha / 255) * 0.9,
              fadeQuickly: Math.random() > density,
            });
          }
        }
      }
      if (particles.length === 0) {
        finish();
        return;
      }

      let last = performance.now();
      let wave = -0.08; // a little runway, so the first letters are not already dust

      const frame = (now: number): void => {
        const dt = Math.min(0.05, (now - last) / 1000);
        last = now;
        wave += dt / duration;

        ctx.clearRect(0, 0, width, height);
        let alive = false;
        const waveX = wave * width;

        for (const particle of particles) {
          if (particle.opacity <= 0.01) continue;

          if (particle.homeX <= waveX) {
            if (particle.velocityX === 0 && particle.velocityY === 0) {
              const angle = Math.random() * Math.PI * 2;
              const speed = (0.35 + Math.random()) * spread * 0.5;
              particle.velocityX = Math.cos(angle) * speed;
              particle.velocityY = Math.sin(angle) * speed * 0.7 - spread * 0.12;
            }
            if (particle.fadeQuickly) {
              particle.opacity = Math.max(0, particle.opacity - dt * 1.6);
            } else {
              const driftX = particle.homeX - particle.x;
              const driftY = particle.homeY - particle.y;
              const distance = Math.hypot(driftX, driftY);
              const damping = Math.max(0.94, 1 - distance / (26 * spread));
              // the ink is going somewhere: up and to the right, like steam off a hot sheet
              particle.velocityX = (particle.velocityX + driftX * 0.002 + spread * 0.06) * damping;
              particle.velocityY = (particle.velocityY + driftY * 0.002 - spread * 0.05) * damping;
              particle.x += particle.velocityX * dt * 10;
              particle.y += particle.velocityY * dt * 10;
              particle.opacity = Math.max(0, particle.opacity - dt * 0.85);
            }
          }

          if (particle.opacity > 0.01) {
            alive = true;
            ctx.globalAlpha = particle.opacity;
            ctx.fillStyle = color;
            ctx.fillRect(Math.round(particle.x), Math.round(particle.y), 1, 1);
          }
        }
        ctx.globalAlpha = 1;

        if (alive && wave < 1.6) {
          raf = requestAnimationFrame(frame);
        } else {
          ctx.clearRect(0, 0, width, height);
          finish();
        }
      };

      raf = requestAnimationFrame(frame);
    };

    void start();

    return () => {
      cancelled = true;
      if (raf) cancelAnimationFrame(raf);
    };
  }, [text, font.family, font.size, font.weight, color, duration, density, spread, onDone]);

  return (
    <div ref={host} className="vapour-host" aria-hidden="true">
      <canvas ref={canvas} className="vapour-canvas" />
    </div>
  );
}