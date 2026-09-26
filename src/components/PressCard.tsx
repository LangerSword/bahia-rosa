import { useEffect, useState, type ReactElement } from "react";
import { motion } from "motion/react";
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
import { PRESS_TIPS } from "../lib/tips";
import "./press-card.css";

/**
 * The card on the loading screen.
 *
 * It turns over while the press runs, and it exists **only** while the press runs: when the art is ready
 * this is unmounted and what the visitor is shown is the art — the first cut of this left the card sitting
 * in the output, which is not what a card is for.
 *
 * Two decisions in here are about the press rather than about looks.
 *
 *   **The metal is rendered once.** three.js with a room environment, one frame, straight into an image —
 *   and then the renderer and its context are disposed. The spin the visitor watches is a CSS transform,
 *   which runs on the compositor. A spin driven by JavaScript would be competing with the press for the
 *   same main thread, and the press always wins that fight: it would stutter exactly when it is meant to
 *   be saying that something is happening. (The card's own face is still measured and fitted, so the
 *   engraving can never collide with itself.)
 *
 *   **With no WebGL it is the same card in CSS, and it still spins.** The loading screen does not get to
 *   disappear because a browser declined to give us a canvas.
 */

const FACE_W = 1256;
const FACE_H = 786;
const CARD_ASPECT = 1.6;
const CARD_W = 1.6;
const CARD_H = 1.0;
const EASE = [0.22, 1, 0.36, 1] as const;

/**
 * The card's face, drawn twice: once in colour for the metal, once in greys for the bump map. The bump
 * pass is what makes the engraving readable — light where the surface stands proud, dark where it was cut
 * into — and both passes run the same layout, so the type cannot drift off its own relief.
 */
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

    // The brushed grain: long, faint, horizontal — the direction the metal was polished in. Deterministic,
    // so every render of this card is the same card.
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
  const soft = pass === "colour" ? "#7a7e88" : "#6a6a72";
  const burr = pass === "colour" ? "rgba(255,255,255,0.7)" : "rgba(255,255,255,0.9)";

  /** Engraved type: the cut, and the burr of metal on its lower lip. Letter by letter, tracked, and fitted
   *  to the room it has — a display face at a fixed size does not know how much room it has. */
  const engraved = (
    text: string,
    x: number,
    y: number,
    font: { size: number; family: string; weight?: number },
    track = 0,
    maxWidth?: number,
    tone: "ink" | "soft" = "ink",
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
    const colour = tone === "ink" ? ink : soft;
    const stampPass = (paint: string, dy: number): void => {
      ctx.fillStyle = paint;
      let at = x;
      chars.forEach((ch, index) => {
        ctx.fillText(ch, at, y + dy);
        at += widths[index];
      });
    };
    stampPass(burr, 2);
    stampPass(colour, 0);
  };

  const left = 74;
  const textWidth = w - left * 2;
  engraved("BAHÍA ROSA", left, 330, { size: 150, family: "Limelight" }, 0, textWidth);
  engraved("LA GAVIOTA · THE COAST EDITION", left, 402, { size: 34, family: '"Poiret One"' }, 7, textWidth);

  ctx.fillStyle = pass === "colour" ? "#fcaf17" : "#4a4a52";
  ctx.fillRect(left, 442, 180, 5);

  engraved("PRINTING IN YOUR BROWSER", left, 700, { size: 24, family: "Inter", weight: 500 }, 5, textWidth, "soft");
}

/** A card: a rounded rectangle with a chamfered edge — flat enough to read as a card, not a slab. */
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

  // ExtrudeGeometry maps its faces in shape space; remap to 0..1 so the art lands on the face.
  const position = geometry.attributes.position as BufferAttribute;
  const uv = new Float32Array(position.count * 2);
  for (let i = 0; i < position.count; i += 1) {
    uv[i * 2] = (position.getX(i) + CARD_W / 2) / CARD_W;
    uv[i * 2 + 1] = (position.getY(i) + CARD_H / 2) / CARD_H;
  }
  geometry.setAttribute("uv", new BufferAttribute(uv, 2));
  return geometry;
}

export function PressCard(): ReactElement {
  const [metal, setMetal] = useState<string | null>(null);
  const [tipIndex, setTipIndex] = useState(0);
  const [reduce] = useState(
    () =>
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  );

  /** A loading screen should give you something new to read while it loads. */
  useEffect(() => {
    if (reduce) return undefined;
    const timer = window.setInterval(
      () => setTipIndex((index) => (index + 1) % PRESS_TIPS.length),
      4600,
    );
    return () => window.clearInterval(timer);
  }, [reduce]);

  /** One frame of real metal, off-screen, then the GPU is handed back before the press starts. */
  useEffect(() => {
    let cancelled = false;
    if (typeof WebGLRenderer === "undefined") return undefined;

    const capture = async (): Promise<void> => {
      // The faces the engraving is cut in have to be there before anything is drawn, or the type is a
      // fallback face wearing the card's layout.
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
        // A three-quarter pose: the metal has to show a reflection and an edge, or it is a grey rectangle
        // with a nice layout on it.
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
        // No metal image. The CSS face is already on screen, and it keeps its spin.
      }
    };

    void capture();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <motion.figure
      className="press-card"
      data-testid="press-card"
      initial={reduce ? undefined : { opacity: 0, y: 12 }}
      animate={reduce ? undefined : { opacity: 1, y: 0 }}
      transition={{ duration: 0.5, ease: EASE }}
    >
      <div className="press-card-stage" aria-hidden="true">
        <span className="press-card-pool" />
        <div
          className="press-card-3d"
          data-testid="press-card-spin"
          data-motion={reduce ? "still" : "spin"}
        >
          {metal ? (
            <img className="press-face press-face-front" src={metal} alt="" />
          ) : (
            // Before the metal render lands (or without WebGL at all): the same card in CSS.
            <div className="press-face press-face-front press-face-css">
              <b>BAHÍA ROSA</b>
              <span>la gaviota · the coast edition</span>
              <i />
            </div>
          )}
          <div className="press-face press-face-back">
            <span>bahía rosa</span>
          </div>
        </div>
      </div>
      <figcaption className="press-caption">
        <span className="kicker press-card-label">the card · being struck</span>
        <p className="press-tip" data-testid="press-tip" key={tipIndex}>
          {PRESS_TIPS[tipIndex]}
        </p>
      </figcaption>
    </motion.figure>
  );
}