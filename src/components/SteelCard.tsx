import { useEffect, useMemo, useRef, useState, type ReactElement } from "react";
import {
  ACESFilmicToneMapping,
  AdditiveBlending,
  BufferAttribute,
  CanvasTexture,
  ExtrudeGeometry,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshPhysicalMaterial,
  NoColorSpace,
  PerspectiveCamera,
  PlaneGeometry,
  PMREMGenerator,
  Scene,
  Shape,
  SRGBColorSpace,
  WebGLRenderer,
} from "three";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { pressStamp, serialFor, tipFor } from "../lib/card";
import "./steel-card.css";

/**
 * The card the plate comes with.
 *
 * The reference was moto-card.com, where the card is not a picture of a card but a thing on a canvas
 * that turns and catches the light. Ours is the same idea with a different job: it is the ceremony that
 * says the press has finished. It arrives when the plate exists, turns once, takes one sweep of light
 * across its face, and settles — and then it stays, because what it says is still true.
 *
 * It is real metal as far as the renderer is concerned: `metalness: 1` with a room environment, so every
 * highlight on it is a reflection rather than a painted gradient. The engraving is a second canvas used
 * as a bump map, which is why the light moving across it reads the type. Under `prefers-reduced-motion`
 * it is a single still frame; with no WebGL it is a flat CSS card with the same facts on it. Either way
 * the fork reads, and nothing here can take the fork down.
 *
 * Cost is bounded like the hero's: one small scene, one texture, a 1024-wide buffer at DPR 1, the loop
 * starts when the card is scrolled to and stops when it is not.
 */

const FACE_W = 1256;
const FACE_H = 786;
const CARD_ASPECT = 1.6;
const CARD_W = 1.6;
const CARD_H = 1.0;

interface FaceFacts {
  serial: string;
  scene: string;
  stamp: string;
  plate: HTMLImageElement | null;
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
): void {
  ctx.beginPath();
  if (typeof ctx.roundRect === "function") {
    ctx.roundRect(x, y, width, height, radius);
    return;
  }
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + width, y, x + width, y + height, radius);
  ctx.arcTo(x + width, y + height, x, y + height, radius);
  ctx.arcTo(x, y + height, x, y, radius);
  ctx.arcTo(x, y, x + width, y, radius);
  ctx.closePath();
}

/**
 * The card's face, drawn twice: once in colour for the metal, once in greys for the bump map. The bump
 * pass is what makes the engraving readable — light where the surface stands proud, dark where it was
 * cut into — and it is the same layout in both passes so the type cannot drift off its own relief.
 */
function drawFace(canvas: HTMLCanvasElement, facts: FaceFacts, pass: "colour" | "bump"): void {
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

    // The brushed grain: long, faint, horizontal — the direction the metal was polished in. Deterministic
    // so two renders of the same card are the same card.
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

    // One broad diagonal polish mark, so the steel is not perfectly uniform.
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

  /**
   * Engraved type: the cut, and the burr of metal on its lower lip. Letter by letter, so it can be tracked,
   * and *fitted* — the first cut of this ran "BAHÍA ROSA" straight under the window on the right, because
   * a display face at a fixed size does not know how much room it has. Anything handed a `maxWidth` is
   * measured first and shrunk to fit it.
   */
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
    const stampPass = (colour: string, dy: number): void => {
      ctx.fillStyle = colour;
      let at = x;
      chars.forEach((ch, index) => {
        ctx.fillText(ch, at, y + dy);
        at += widths[index];
      });
    };
    stampPass(burr, 2);
    stampPass(ink, 0);
  };

  // The plate, set into the steel like a window: flush, lit at the top edge, grooved around.
  const winX = 686;
  const winY = 72;
  const winW = 500;
  const winH = 642;
  ctx.save();
  roundRect(ctx, winX, winY, winW, winH, 26);
  ctx.clip();
  if (pass === "colour") {
    ctx.fillStyle = "#0a0a0e";
    ctx.fillRect(winX, winY, winW, winH);
    const image = facts.plate;
    if (image) {
      const scale = Math.max(winW / image.width, winH / image.height);
      const drawnW = image.width * scale;
      const drawnH = image.height * scale;
      ctx.drawImage(image, winX + (winW - drawnW) / 2, winY + (winH - drawnH) / 2, drawnW, drawnH);
      const flush = ctx.createLinearGradient(0, winY, 0, winY + winH * 0.55);
      flush.addColorStop(0, "rgba(255,255,255,0.12)");
      flush.addColorStop(1, "rgba(255,255,255,0)");
      ctx.fillStyle = flush;
      ctx.fillRect(winX, winY, winW, winH);
      // A groove around the print: the window is cut into the face, so its top edge carries a shadow and
      // its lower edge a lit lip — the same trick as the engraving, at the scale of the whole window.
      // (The first cut of this read as a sticker laid on the metal; this is what seats it.)
      const seat = ctx.createLinearGradient(0, winY, 0, winY + winH);
      seat.addColorStop(0, "rgba(6,6,10,0.55)");
      seat.addColorStop(0.05, "rgba(6,6,10,0)");
      seat.addColorStop(0.95, "rgba(255,255,255,0)");
      seat.addColorStop(1, "rgba(255,255,255,0.35)");
      ctx.fillStyle = seat;
      ctx.fillRect(winX, winY, winW, winH);
    }
  } else {
    ctx.fillStyle = "#c2c2c6";
    ctx.fillRect(winX, winY, winW, winH);
  }
  ctx.restore();

  ctx.save();
  roundRect(ctx, winX, winY, winW, winH, 26);
  ctx.lineWidth = 3;
  ctx.strokeStyle = pass === "colour" ? "rgba(20,20,26,0.5)" : "#3a3a42";
  ctx.stroke();
  ctx.restore();

  const left = 74;
  // Everything on the card is fitted to the room it has before the window starts, so no two parts of the
  // engraving can ever collide however long a place name is.
  const textWidth = winX - left - 30;
  engraved("BAHÍA ROSA", left, 244, { size: 112, family: "Limelight" }, 0, textWidth);
  engraved("LA GAVIOTA · THE COAST EDITION", left, 306, { size: 30, family: '"Poiret One"' }, 6, textWidth);

  ctx.fillStyle = pass === "colour" ? "#fcaf17" : "#4a4a52";
  ctx.fillRect(left, 336, 132, 4);

  engraved("ONE OF ONE", left, 552, { size: 24, family: "Inter", weight: 500 }, 6, textWidth);
  engraved(facts.serial, left, 614, { size: 48, family: "Inter", weight: 600 }, 2, textWidth);
  engraved(facts.scene.toUpperCase(), left, 672, { size: 30, family: '"Poiret One"' }, 5, textWidth);
  engraved(facts.stamp.toUpperCase(), left, 716, { size: 24, family: "Inter", weight: 500 }, 4, textWidth);
}

/** A card: a rounded rectangle with a chamfered edge, flat enough to read as a card and not a slab. */
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

  // ExtrudeGeometry maps its faces in shape space; remap to 0..1 so the art lands on the face. The edges
  // then share the face's edge pixels, which is what a machined chamfer does anyway.
  const position = geometry.attributes.position as BufferAttribute;
  const uv = new Float32Array(position.count * 2);
  for (let i = 0; i < position.count; i += 1) {
    uv[i * 2] = (position.getX(i) + CARD_W / 2) / CARD_W;
    uv[i * 2 + 1] = (position.getY(i) + CARD_H / 2) / CARD_H;
  }
  geometry.setAttribute("uv", new BufferAttribute(uv, 2));
  return geometry;
}

export function SteelCard({ plate, scene }: { plate: string; scene: string }): ReactElement {
  const host = useRef<HTMLDivElement>(null);
  const [failed, setFailed] = useState(false);

  // Keyed by the plate: a new print is a new card, the same print is the same card.
  const pressedAt = useMemo(() => new Date(), [plate]);
  // The middle of the plate's bytes, not its head — see `serialFor`.
  const serial = useMemo(
    () => serialFor(`${scene}|${plate.length}|${plate.slice(1024, 5120)}`),
    [plate, scene],
  );
  const stamp = useMemo(() => pressStamp(pressedAt), [pressedAt]);
  const tip = useMemo(() => tipFor(serial), [serial]);

  useEffect(() => {
    const node = host.current;
    if (!node) return;
    if (typeof WebGLRenderer === "undefined") {
      setFailed(true);
      return;
    }

    const reduce =
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    let renderer: WebGLRenderer;
    try {
      renderer = new WebGLRenderer({ antialias: true, alpha: true, powerPreference: "low-power" });
    } catch {
      setFailed(true);
      return;
    }

    const boxWidth = node.clientWidth || 900;
    const width = Math.min(Math.max(640, Math.round(boxWidth)), 1024);
    const height = Math.round(width / CARD_ASPECT);
    renderer.setPixelRatio(1);
    renderer.setSize(width, height, false);
    renderer.toneMapping = ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.08;
    renderer.domElement.style.width = "100%";
    renderer.domElement.style.height = "auto";
    renderer.domElement.setAttribute("aria-hidden", "true");
    node.appendChild(renderer.domElement);

    const field = new Scene();
    const camera = new PerspectiveCamera(26, CARD_ASPECT, 0.1, 40);
    camera.position.set(0, 0.04, 4.5);
    camera.lookAt(0, 0, 0);

    // Every highlight on the metal is a reflection of this room. It is the difference between steel and
    // a grey rectangle pretending to be steel.
    const pmrem = new PMREMGenerator(renderer);
    const environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    field.environment = environment;

    const group = new Group();
    field.add(group);

    const geometry = cardGeometry();

    let disposed = false;
    let raf = 0;
    let idle: ReturnType<typeof setTimeout> | null = null;

    const start = (): void => {
      if (raf) return;
      raf = requestAnimationFrame(frame);
    };
    const stop = (): void => {
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
    };
    const settleSoon = (): void => {
      if (idle) clearTimeout(idle);
      idle = setTimeout(stop, 9000);
    };

    const target = { x: 0, y: 0 };
    const onPointer = (event: PointerEvent): void => {
      const box = node.getBoundingClientRect();
      target.x = ((event.clientX - box.left) / box.width - 0.5) * 0.6;
      target.y = ((event.clientY - box.top) / box.height - 0.5) * 0.4;
      start();
      settleSoon();
    };

    const render = (): void => renderer.render(field, camera);

    // The entrance: a turn from three-quarters away to face-on, one sweep of light, then it holds still.
    const START = { rotY: -1.15, rotX: 0.52 };
    const SETTLE = { rotY: -0.17, rotX: 0.1 };
    let sheen: Mesh | null = null;
    let sheenMaterial: MeshBasicMaterial | null = null;
    let body: MeshPhysicalMaterial | null = null;
    let began = performance.now();

    const clamp01 = (value: number): number => Math.min(1, Math.max(0, value));
    const easeOutCubic = (t: number): number => 1 - (1 - t) ** 3;
    const easeOutQuad = (t: number): number => 1 - (1 - t) ** 2;

    const frame = (now: number): void => {
      raf = requestAnimationFrame(frame);
      const seconds = (now - began) / 1000;
      const p = clamp01(seconds / 1.7);
      const spin = easeOutCubic(p);

      const overshoot = Math.sin(clamp01((p - 0.5) / 0.5) * Math.PI) * 0.05;
      const floatY = p >= 1 ? Math.sin((seconds - 1.7) * 0.45) * 0.012 : 0;
      const floatX = p >= 1 ? Math.cos((seconds - 1.7) * 0.35) * 0.01 : 0;
      group.rotation.y = START.rotY + (SETTLE.rotY - START.rotY) * spin + overshoot + floatY + target.x * 0.06;
      group.rotation.x = START.rotX + (SETTLE.rotX - START.rotX) * spin + floatX + target.y * 0.05;
      group.position.y = -0.55 * (1 - spin);
      group.scale.setScalar(0.9 + 0.1 * spin);

      if (body) body.opacity = easeOutQuad(clamp01(seconds / 0.45));

      if (sheen && sheenMaterial) {
        const sweep = clamp01((seconds - 0.45) / 1.25);
        sheen.position.x = -1.35 + 2.7 * easeOutQuad(sweep);
        sheenMaterial.opacity = Math.sin(sweep * Math.PI) * 0.5;
      }

      render();
    };

    void document.fonts.ready.then(() => {
      const image = new Image();
      image.decoding = "async";
      image.src = plate;
      return image
        .decode()
        .then(() => image)
        .catch(() => null);
    }).then((image) => {
      if (disposed) return;

      const face = document.createElement("canvas");
      const bump = document.createElement("canvas");
      for (const canvas of [face, bump]) {
        canvas.width = FACE_W;
        canvas.height = FACE_H;
      }
      const facts: FaceFacts = { serial, scene, stamp, plate: image };
      drawFace(face, facts, "colour");
      drawFace(bump, facts, "bump");

      const faceTexture = new CanvasTexture(face);
      faceTexture.colorSpace = SRGBColorSpace;
      faceTexture.anisotropy = Math.min(4, renderer.capabilities.getMaxAnisotropy());
      const bumpTexture = new CanvasTexture(bump);
      bumpTexture.colorSpace = NoColorSpace;

      body = new MeshPhysicalMaterial({
        map: faceTexture,
        bumpMap: bumpTexture,
        bumpScale: 0.55,
        metalness: 1,
        roughness: 0.28,
        clearcoat: 0.35,
        clearcoatRoughness: 0.4,
        envMapIntensity: 1.15,
        transparent: true,
        opacity: 0,
      });
      group.add(new Mesh(geometry, body));

      // The sweep: a band of light, drawn over the face, that crosses once as the card turns.
      const sheenCanvas = document.createElement("canvas");
      sheenCanvas.width = 128;
      sheenCanvas.height = 512;
      const sheenCtx = sheenCanvas.getContext("2d");
      if (sheenCtx) {
        const band = sheenCtx.createLinearGradient(0, 0, 128, 0);
        band.addColorStop(0, "rgba(255,255,255,0)");
        band.addColorStop(0.45, "rgba(255,255,255,0.85)");
        band.addColorStop(0.55, "rgba(255,255,255,0.85)");
        band.addColorStop(1, "rgba(255,255,255,0)");
        sheenCtx.fillStyle = band;
        sheenCtx.fillRect(0, 0, 128, 512);
      }
      sheenMaterial = new MeshBasicMaterial({
        map: new CanvasTexture(sheenCanvas),
        transparent: true,
        opacity: 0,
        blending: AdditiveBlending,
        depthWrite: false,
      });
      sheen = new Mesh(new PlaneGeometry(0.85, 2.4), sheenMaterial);
      sheen.rotation.z = -0.32;
      sheen.position.z = 0.055;
      group.add(sheen);

      if (reduce) {
        // A still frame of the same card: no turn, no sweep.
        group.rotation.set(SETTLE.rotX, SETTLE.rotY, 0);
        group.position.y = 0;
        group.scale.setScalar(1);
        body.opacity = 1;
        render();
      } else {
        began = performance.now();
        start();
        settleSoon();
      }
    });

    // The card turns when it is looked at. A fork below the fold should not be rendering a turn nobody
    // is there for, and a fork scrolled away should stop paying for one.
    let seen = false;
    const observer =
      typeof IntersectionObserver === "function"
        ? new IntersectionObserver(
            (entries) => {
              for (const entry of entries) {
                if (entry.isIntersecting) {
                  if (!seen) {
                    seen = true;
                    began = performance.now();
                  }
                  if (!reduce) start();
                  settleSoon();
                } else {
                  stop();
                }
              }
            },
            { threshold: 0.15 },
          )
        : null;
    if (observer) observer.observe(node);

    node.addEventListener("pointermove", onPointer);

    const onResize = (): void => {
      const nextWidth = Math.min(Math.max(640, Math.round(node.clientWidth || boxWidth)), 1024);
      const nextHeight = Math.round(nextWidth / CARD_ASPECT);
      renderer.setSize(nextWidth, nextHeight, false);
      render();
    };
    window.addEventListener("resize", onResize);

    return () => {
      disposed = true;
      stop();
      if (idle) clearTimeout(idle);
      observer?.disconnect();
      node.removeEventListener("pointermove", onPointer);
      window.removeEventListener("resize", onResize);
      geometry.dispose();
      group.traverse((child) => {
        const mesh = child as Mesh;
        mesh.geometry?.dispose?.();
        const material = mesh.material as MeshBasicMaterial | MeshBasicMaterial[] | undefined;
        if (Array.isArray(material)) material.forEach((entry) => entry.dispose());
        else material?.dispose?.();
      });
      environment.dispose();
      pmrem.dispose();
      renderer.dispose();
      if (renderer.domElement.parentNode === node) node.removeChild(renderer.domElement);
    };
    // `serial`, `scene` and `stamp` are derived from `plate`; the effect is keyed by what it draws.
  }, [plate, scene, serial, stamp]);

  const caption = (
    <figcaption className="steel-meta">
      <span className="steel-serial">{serial}</span>
      <span className="steel-when">
        {scene} · {stamp}
      </span>
      <span className="steel-tip" data-testid="steel-tip">
        {tip}
      </span>
    </figcaption>
  );

  if (failed) {
    // No WebGL, no problem: the same card as a flat print, and the fork reads exactly the same.
    return (
      <figure className="steel-stage" data-testid="steel-card" data-serial={serial}>
        <div className="steel-fallback" aria-hidden="true">
          <b>BAHÍA ROSA</b>
          <span>la gaviota · the coast edition</span>
          <em>{scene.toUpperCase()}</em>
          <strong>{serial}</strong>
          <small>{stamp}</small>
        </div>
        {caption}
      </figure>
    );
  }

  return (
    <figure className="steel-stage" data-testid="steel-card" data-serial={serial}>
      <div
        className="steel-canvas"
        ref={host}
        role="img"
        aria-label={`Your plate, set into a stainless card engraved ${serial}`}
      />
      {caption}
    </figure>
  );
}