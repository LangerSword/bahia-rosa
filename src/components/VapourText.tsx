import { useEffect, useRef, type ReactElement } from "react";

/**
 * Type that turns to dust.
 *
 * The mechanic is from the vapour-text component on 21st.dev, rebuilt for this site: the text is rendered
 * once to an offscreen canvas, sampled into a particle per few pixels, and a wave sweeps across it — every
 * particle the wave reaches takes a velocity, damps toward rest, and fades. Roughly two thousand specks,
 * a second of it, and the wordmark is gone.
 *
 * Three things are deliberately *not* carried over, because they are about a component library and not
 * about this page: it renders at device-pixel-ratio 1 (the visitor's machine is running the press, and
 * dust does not need retina), it never runs under `prefers-reduced-motion` (it reports done immediately,
 * so the sheet lifts as it always has for those visitors), and it **reports when it is finished** — the
 * sheet's lift waits for the last particle rather than racing it, which is the whole reason this exists
 * at the exit rather than as a decoration that plays over one.
 */

interface VapourTextProps {
  text: string;
  font: { family: string; size: number; weight?: number };
  color: string;
  /** Seconds for the wave to cross the text. */
  duration?: number;
  /** 0–1: how much of each particle's opacity is spent before it is blown away. */
  density?: number;
  /** How far a particle travels from where it was, in pixels at the sampled size. */
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

    const reduce =
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce) {
      if (!done.current) {
        done.current = true;
        onDone();
      }
      return undefined;
    }

    const ctx = surface.getContext("2d");
    if (!ctx) {
      onDone();
      return undefined;
    }

    const finish = (): void => {
      if (!done.current) {
        done.current = true;
        onDone();
      }
    };

    // The canvas is the wordmark's own box, at DPR 1.
    const width = Math.max(1, Math.round(node.clientWidth));
    const height = Math.max(1, Math.round(node.clientHeight));
    surface.width = width;
    surface.height = height;
    surface.style.width = `${width}px`;
    surface.style.height = `${height}px`;

    // Sample the type into particles once, where the DOM text was.
    ctx.font = `${font.weight ?? 400} ${font.size}px ${font.family}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.imageSmoothingEnabled = true;
    ctx.fillStyle = color;
    ctx.fillText(text, width / 2, height / 2);
    const image = ctx.getImageData(0, 0, width, height).data;
    ctx.clearRect(0, 0, width, height);

    const step = Math.max(2, Math.round(font.size / 34));
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
      return undefined;
    }

    let raf = 0;
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
    return () => {
      if (raf) cancelAnimationFrame(raf);
    };
  }, [text, font.family, font.size, font.weight, color, duration, density, spread, onDone]);

  return (
    <div ref={host} className="vapour-host" aria-hidden="true">
      <canvas ref={canvas} />
    </div>
  );
}