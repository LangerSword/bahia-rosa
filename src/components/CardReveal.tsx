import { useEffect, useRef, useState, type ReactElement, type ReactNode } from "react";
import { animate, motion, useMotionValue, useReducedMotion } from "motion/react";
import {
  ACESFilmicToneMapping,
  BufferAttribute,
  CanvasTexture,
  ExtrudeGeometry,
  Group,
  Mesh,
  MeshPhysicalMaterial,
  NoColorSpace,
  PerspectiveCamera,
  PMREMGenerator,
  Scene,
  Shape,
  SRGBColorSpace,
  WebGLRenderer,
} from "three";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import "./press.css";

/**
 * The reveal.
 *
 * The press finishes and the plate does not simply appear: a card turns over on the spot — rapidly, once
 * every 0.6s — and then *lands*, decelerating to a stop with the visitor's own art on its face, and the art
 * is what is left when it stops. The card is the framing device, not the product; it is unmounted the moment
 * the art is up.
 *
 * The turn is a React animation (`useMotionValue` + `animate` from motion), which is what lets the landing
 * work: a CSS loop cannot be *arrived at*. Here the loop is stopped mid-flight, and the angle it was caught
 * at is used as the start of a decelerating landing onto the next full turn — so the card always comes to
 * rest face-on, and it never has to jump to get there.
 *
 * Its other face is the same stainless the site's loading screen showed: three.js, rendered **once**,
 * off-screen, into an image, and the renderer and its context are disposed immediately afterwards. The card
 * is the art's own shape (measured from the plate), so the landing does not reflow the page.
 */

const FACE_W = 1256;
const FACE_H = 786;
const CARD_ASPECT = 1.6;
const CARD_W = 1.6;
const CARD_H = 1.0;

/** One revolution of the spin. "Rapidly" is 0.6s a turn. */
const REV_MS = 600;
/** How long it spins before it is caught: a bit over two turns. */
const SPIN_MS = 1300;
/** The landing: from wherever it was caught to the next full turn, easing out. */
const SETTLE_MS = 750;
/** The beat it holds, art up, before the card gives way to the print. */
const HOLD_MS = 220;

const EASE = [0.22, 1, 0.36, 1] as const;
const LAND = [0.16, 1, 0.3, 1] as const;

/** The card's brand face, in colour and as a bump map — the same engraving the loading screen carries. */
function drawFace(canvas: HTMLCanvasElement, pass: "colour" | "bump"): void {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const { width: w, height: h } = canvas;
  ctx.clearRect(0, 0, w, h);

  if (pass === "colour") {
    const steel = ctx.createLinearGradient(0, 0, w, h);
    steel.addColorStop(0, "#d3d6db");
    steel.addColorStop(0.42, "#b6b9c0");
    steel.addColorStop(0.6, "#c9ccd2");
    steel.addColorStop(1, "#a4a8b0");
    ctx.fillStyle = steel;
    ctx.fillRect(0, 0, w, h);

    let seed = 20260926;
    const rand = (): number => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed / 2147483648;
    };
    for (let i = 0; i < 3200; i += 1) {
      const y = rand() * h;
      ctx.fillStyle =
        rand() > 0.5
          ? `rgba(255, 255, 255, ${0.02 + rand() * 0.05})`
          : `rgba(24, 24, 30, ${0.015 + rand() * 0.04})`;
      ctx.fillRect(0, y, w, 1);
    }

    const polish = ctx.createLinearGradient(0, h, w, 0);
    polish.addColorStop(0, "rgba(255,255,255,0)");
    polish.addColorStop(0.5, "rgba(255,255,255,0.10)");
    polish.addColorStop(1, "rgba(10,10,14,0.14)");
    ctx.fillStyle = polish;
    ctx.fillRect(0, 0, w, h);
  } else {
    ctx.fillStyle = "#e8e8ec";
    ctx.fillRect(0, 0, w, h);
  }

  const ink = pass === "colour" ? "#4c505a" : "#3c3c44";
  const burr = pass === "colour" ? "rgba(255,255,255,0.7)" : "rgba(255,255,255,0.9)";

  const engraved = (
    text: string,
    x: number,
    y: number,
    font: { size: number; family: string; weight?: number },
    track = 0,
    maxWidth?: number,
  ): void => {
    const { size, family, weight = 400 } = font;
    const widthAt = (px: number): number => {
      const tracking = track * (px / size);
      ctx.font = `${weight} ${px}px ${family}`;
      const widths = [...text].map((ch) => ctx.measureText(ch).width + tracking);
      return widths.reduce((sum, value) => sum + value, 0) - (text ? tracking : 0);
    };
    let px = size;
    if (maxWidth) {
      const measured = widthAt(size);
      if (measured > maxWidth) px = Math.max(11, Math.floor((size * maxWidth) / measured));
    }
    const tracking = track * (px / size);
    ctx.font = `${weight} ${px}px ${family}`;
    const chars = [...text];
    const widths = chars.map((ch) => ctx.measureText(ch).width + tracking);
    const stampPass = (paint: string, dy: number): void => {
      ctx.fillStyle = paint;
      let at = x;
      chars.forEach((ch, index) => {
        ctx.fillText(ch, at, y + dy);
        at += widths[index];
      });
    };
    stampPass(burr, 2);
    stampPass(ink, 0);
  };

  const left = 74;
  const textWidth = w - left * 2;
  engraved("BAHÍA ROSA", left, 330, { size: 150, family: "Limelight" }, 0, textWidth);
  engraved("LA GAVIOTA · THE COAST EDITION", left, 402, { size: 34, family: '"Poiret One"' }, 7, textWidth);

  ctx.fillStyle = pass === "colour" ? "#fcaf17" : "#4a4a52";
  ctx.fillRect(left, 442, 180, 5);
}

function cardGeometry(): ExtrudeGeometry {
  const radius = 0.07;
  const x = -CARD_W / 2;
  const y = -CARD_H / 2;
  const shape = new Shape();
  shape.moveTo(x + radius, y);
  shape.lineTo(x + CARD_W - radius, y);
  shape.quadraticCurveTo(x + CARD_W, y, x + CARD_W, y + radius);
  shape.lineTo(x + CARD_W, y + CARD_H - radius);
  shape.quadraticCurveTo(x + CARD_W, y + CARD_H, x + CARD_W - radius, y + CARD_H);
  shape.lineTo(x + radius, y + CARD_H);
  shape.quadraticCurveTo(x, y + CARD_H, x, y + CARD_H - radius);
  shape.lineTo(x, y + radius);
  shape.quadraticCurveTo(x, y, x + radius, y);

  const geometry = new ExtrudeGeometry(shape, {
    depth: 0.05,
    bevelEnabled: true,
    bevelThickness: 0.008,
    bevelSize: 0.008,
    bevelSegments: 2,
    curveSegments: 12,
  });
  geometry.center();

  const position = geometry.attributes.position as BufferAttribute;
  const uv = new Float32Array(position.count * 2);
  for (let i = 0; i < position.count; i += 1) {
    uv[i * 2] = (position.getX(i) + CARD_W / 2) / CARD_W;
    uv[i * 2 + 1] = (position.getY(i) + CARD_H / 2) / CARD_H;
  }
  geometry.setAttribute("uv", new BufferAttribute(uv, 2));
  return geometry;
}

/**
 * The card that turns over, then hands the page its art.
 *
 * `children` are the art itself (the printed plate, already framed by the caller): they mount when the card
 * has landed, which is what makes the arrival a *reveal* rather than a swap.
 */
export function CardReveal({ plate, children }: { plate: string; children: ReactNode }): ReactElement {
  const reduce = useReducedMotion();
  const [metal, setMetal] = useState<string | null>(null);
  const [ratio, setRatio] = useState(CARD_ASPECT);
  const [phase, setPhase] = useState<"spin" | "settle" | "art">("spin");
  const rotate = useMotionValue(0);
  const running = useRef<{ stop: () => void } | null>(null);

  /** The card is the art's own shape, so the landing cannot reflow the page. */
  useEffect(() => {
    const image = new Image();
    image.decoding = "async";
    image.src = plate;
    void image
      .decode()
      .then(() => {
        if (image.naturalWidth > 0 && image.naturalHeight > 0) {
          setRatio(image.naturalWidth / image.naturalHeight);
        }
      })
      .catch(() => undefined);
  }, [plate]);

  /** One frame of real metal for the card's other face, then the GPU is handed straight back. */
  useEffect(() => {
    let cancelled = false;
    if (typeof WebGLRenderer === "undefined") return undefined;

    const capture = async (): Promise<void> => {
      await document.fonts.load('150px "Limelight"').catch(() => undefined);
      await document.fonts.load('34px "Poiret One"').catch(() => undefined);
      await document.fonts.ready.catch(() => undefined);
      if (cancelled) return;

      let renderer: WebGLRenderer;
      try {
        renderer = new WebGLRenderer({
          antialias: true,
          alpha: true,
          powerPreference: "low-power",
          preserveDrawingBuffer: true,
        });
      } catch {
        return;
      }

      try {
        const width = 1024;
        const height = Math.round(width / CARD_ASPECT);
        renderer.setPixelRatio(1);
        renderer.setSize(width, height, false);
        renderer.toneMapping = ACESFilmicToneMapping;
        renderer.toneMappingExposure = 1.08;

        const field = new Scene();
        const camera = new PerspectiveCamera(26, CARD_ASPECT, 0.1, 40);
        camera.position.set(0, 0.05, 4.5);
        camera.lookAt(0, 0, 0);

        const pmrem = new PMREMGenerator(renderer);
        const environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
        field.environment = environment;

        const face = document.createElement("canvas");
        const bump = document.createElement("canvas");
        for (const canvas of [face, bump]) {
          canvas.width = FACE_W;
          canvas.height = FACE_H;
        }
        drawFace(face, "colour");
        drawFace(bump, "bump");

        const faceTexture = new CanvasTexture(face);
        faceTexture.colorSpace = SRGBColorSpace;
        faceTexture.anisotropy = Math.min(4, renderer.capabilities.getMaxAnisotropy());
        const bumpTexture = new CanvasTexture(bump);
        bumpTexture.colorSpace = NoColorSpace;

        const material = new MeshPhysicalMaterial({
          map: faceTexture,
          bumpMap: bumpTexture,
          bumpScale: 0.55,
          metalness: 1,
          roughness: 0.28,
          clearcoat: 0.35,
          clearcoatRoughness: 0.4,
          envMapIntensity: 1.15,
        });

        const geometry = cardGeometry();
        const group = new Group();
        group.add(new Mesh(geometry, material));
        group.rotation.set(0.08, -0.22, 0);
        field.add(group);

        renderer.render(field, camera);
        const url = renderer.domElement.toDataURL("image/png");

        geometry.dispose();
        material.dispose();
        faceTexture.dispose();
        bumpTexture.dispose();
        environment.dispose();
        pmrem.dispose();
        renderer.dispose();
        renderer.forceContextLoss();

        if (!cancelled && url.startsWith("data:image")) setMetal(url);
      } catch {
        // No metal image: the back face falls back to the wordmark, and the reveal still runs.
      }
    };

    void capture();
    return () => {
      cancelled = true;
    };
  }, []);

  /** The turn: spin, get caught, land on the next full turn, hold a beat, hand over the art. */
  useEffect(() => {
    if (reduce) {
      setPhase("art");
      return undefined;
    }

    setPhase("spin");
    running.current = animate(rotate, 360, {
      repeat: Infinity,
      ease: "linear",
      duration: REV_MS / 1000,
    });

    const catchIt = window.setTimeout(() => {
      running.current?.stop();
      // Land from wherever it was caught onto the next whole turn — always less than one full turn away,
      // and always face-on at the end.
      const caught = rotate.get();
      const remainder = ((caught % 360) + 360) % 360;
      const target = caught + (remainder === 0 ? 360 : 360 + (360 - remainder));
      setPhase("settle");
      running.current = animate(rotate, target, { duration: SETTLE_MS / 1000, ease: LAND });
    }, SPIN_MS);

    const handOver = window.setTimeout(() => setPhase("art"), SPIN_MS + SETTLE_MS + HOLD_MS);

    return () => {
      running.current?.stop();
      window.clearTimeout(catchIt);
      window.clearTimeout(handOver);
    };
  }, [reduce, rotate]);

  if (reduce || phase === "art") {
    return (
      <motion.div
        className="reveal-art plate-sweep"
        initial={reduce ? undefined : { opacity: 0, scale: 0.994 }}
        animate={reduce ? undefined : { opacity: 1, scale: 1 }}
        transition={{ duration: 0.55, ease: EASE }}
      >
        {children}
      </motion.div>
    );
  }

  return (
    <div className="reveal-stage" aria-hidden="true">
      <motion.div
        className="reveal-card"
        data-testid="card-reveal"
        data-phase={phase}
        style={{ rotateY: rotate, aspectRatio: `${ratio}` }}
      >
        <div className="reveal-face reveal-front">
          <img src={plate} alt="" />
          <span className="reveal-sheen" />
        </div>
        <div className="reveal-face reveal-back">
          {metal ? <img src={metal} alt="" /> : <b>bahía rosa</b>}
        </div>
      </motion.div>
    </div>
  );
}