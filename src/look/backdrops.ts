/**
 * The city, drawn.
 *
 * Three backdrops, generated in the browser: no assets, no model, nothing to download. Every one is
 * built the way a painted key-art plate is built — a sky gradient, a low sun, cloud bands, a skyline
 * in silhouette, palms in the foreground, water that reflects the light.
 *
 * `t` is seconds since the scene opened, so the same function that paints the still also animates it:
 * the clouds drift, the water shimmers, the sun breathes. Nothing here depends on a random number
 * generator — the noise is a hash of position and seed, so a given photograph always gets the same
 * city.
 */

export type BackdropId = "dusk" | "neon" | "coast";

export interface Backdrop {
  label: string;
  blurb: string;
  /** Sky gradient, top to horizon. */
  sky: [string, string, string];
  /** The darker band the skyline sits on. */
  haze: string;
  accent: string;
  /** Where the sun sits, as a fraction of width and height. */
  sun: [number, number];
}

export const BACKDROPS: Record<BackdropId, Backdrop> = {
  dusk: {
    label: "Bahía dusk",
    blurb: "the sun is going down behind the towers",
    sky: ["#1b1035", "#7a2a5c", "#ff7a3d"],
    haze: "#f0a35c",
    accent: "#ffd08a",
    sun: [0.7, 0.42],
  },
  neon: {
    label: "Neon strip",
    blurb: "after the rain, every sign on",
    sky: ["#0b0820", "#2a1150", "#c62b7c"],
    haze: "#ff4fa3",
    accent: "#5fe6f0",
    sun: [0.28, 0.3],
  },
  coast: {
    label: "Gold coast",
    blurb: "high sun, long water, nothing but light",
    sky: ["#123a5c", "#3f9ec4", "#ffd98a"],
    haze: "#ffe6ad",
    accent: "#fff2cc",
    sun: [0.58, 0.26],
  },
};

function hash(x: number, y: number, seed: number): number {
  let h = (x * 374761393 + y * 668265263 + seed * 2246822519) >>> 0;
  h = (h ^ (h >>> 13)) >>> 0;
  h = Math.imul(h, 1274126177) >>> 0;
  return ((h ^ (h >>> 16)) / 4294967295) * 2 - 1;
}

function pseudo(seed: number, index: number): number {
  return (hash(index, index * 7 + 3, seed) + 1) / 2;
}

/** A palm, in silhouette: a leaning trunk and seven fronds. */
function palm(
  ctx: CanvasRenderingContext2D,
  x: number,
  baseY: number,
  height: number,
  lean: number,
  colour: string,
  sway: number,
): void {
  ctx.save();
  ctx.strokeStyle = colour;
  ctx.fillStyle = colour;
  ctx.lineCap = "round";

  const topX = x + lean * height;
  const topY = baseY - height;

  // Trunk, drawn as a tapering curve.
  ctx.lineWidth = Math.max(2, height * 0.035);
  ctx.beginPath();
  ctx.moveTo(x, baseY);
  ctx.quadraticCurveTo(x + lean * height * 0.3, baseY - height * 0.55, topX, topY);
  ctx.stroke();

  // Fronds: seven arcs from the crown, each a little different, all swaying together.
  const frondLength = height * 0.42;
  for (let f = 0; f < 7; f += 1) {
    const angle = (-Math.PI * 0.92 + (f / 6) * Math.PI * 0.84) + sway * 0.05;
    const droop = f % 2 === 0 ? 0.5 : 0.75;
    const midX = topX + Math.cos(angle) * frondLength * 0.6;
    const midY = topY + Math.sin(angle) * frondLength * 0.4;
    const endX = topX + Math.cos(angle) * frondLength;
    const endY = topY + Math.sin(angle) * frondLength * droop + frondLength * 0.22;
    ctx.lineWidth = Math.max(1.5, height * 0.012);
    ctx.beginPath();
    ctx.moveTo(topX, topY);
    ctx.quadraticCurveTo(midX, midY, endX, endY);
    ctx.stroke();
  }
  ctx.restore();
}

/** The low sun: a disc plus the light it throws, screened over the sky. */
function sun(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  radius: number,
  accent: string,
  t: number,
): void {
  const breathe = 1 + Math.sin(t * 0.3) * 0.03;
  const glow = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius * 6 * breathe);
  glow.addColorStop(0, accent);
  glow.addColorStop(0.16, "rgba(255, 214, 150, 0.5)");
  glow.addColorStop(0.5, "rgba(255, 140, 80, 0.14)");
  glow.addColorStop(1, "rgba(255, 120, 60, 0)");
  ctx.save();
  ctx.globalCompositeOperation = "screen";
  ctx.fillStyle = glow;
  ctx.beginPath();
  ctx.arc(cx, cy, radius * 6 * breathe, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = accent;
  ctx.beginPath();
  ctx.arc(cx, cy, radius * breathe, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

/** Cloud bands, drifting sideways. */
function clouds(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  horizon: number,
  colour: string,
  t: number,
  seed: number,
): void {
  ctx.save();
  for (let band = 0; band < 4; band += 1) {
    const y = horizon * (0.2 + band * 0.16);
    const thickness = height * (0.02 + band * 0.006);
    const drift = ((t * (6 + band * 2)) % (width * 1.6)) - width * 0.3;
    ctx.globalAlpha = 0.12 + band * 0.03;
    ctx.fillStyle = colour;
    for (let i = 0; i < 7; i += 1) {
      const span = width * (0.22 + pseudo(seed + band, i) * 0.3);
      const x = ((i * width * 0.28 + drift + pseudo(seed, i + band) * 40) % (width * 1.5)) - width * 0.2;
      ctx.beginPath();
      ctx.ellipse(x, y, span, thickness, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.restore();
}

/** A skyline in silhouette, with lit windows. */
function skyline(
  ctx: CanvasRenderingContext2D,
  width: number,
  horizon: number,
  height: number,
  colour: string,
  light: string,
  t: number,
  seed: number,
): void {
  ctx.save();
  ctx.fillStyle = colour;
  let x = -20;
  let index = 0;
  while (x < width + 20) {
    const towerWidth = 26 + pseudo(seed, index) * 54;
    const towerHeight = height * (0.06 + pseudo(seed + 1, index) * 0.16);
    const top = horizon - towerHeight;
    ctx.fillRect(x, top, towerWidth, towerHeight + height * 0.05);

    // Lit windows: a sparse grid, some of them flickering, which is what makes a skyline read as
    // inhabited rather than as a bar chart.
    const columns = Math.max(2, Math.floor(towerWidth / 9));
    const rows = Math.max(2, Math.floor(towerHeight / 11));
    for (let c = 0; c < columns; c += 1) {
      for (let r = 0; r < rows; r += 1) {
        const lit = pseudo(seed + 2 + c * 13 + r * 7, index);
        if (lit < 0.42) continue;
        const flicker = lit > 0.94 ? 0.5 + 0.5 * Math.sin(t * 2 + index) : 1;
        ctx.globalAlpha = 0.35 + 0.5 * flicker;
        ctx.fillStyle = light;
        ctx.fillRect(x + 4 + c * 9, top + 6 + r * 11, 3, 4);
        ctx.fillStyle = colour;
        ctx.globalAlpha = 1;
      }
    }
    x += towerWidth + 6 + pseudo(seed + 3, index) * 14;
    index += 1;
  }
  ctx.restore();
}

/** Water: a mirrored sun path and ripple lines. */
function water(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  from: number,
  accent: string,
  sunX: number,
  t: number,
  seed: number,
): void {
  ctx.save();
  const sea = ctx.createLinearGradient(0, from, 0, height);
  sea.addColorStop(0, "rgba(10, 14, 30, 0.25)");
  sea.addColorStop(1, "rgba(4, 6, 16, 0.85)");
  ctx.fillStyle = sea;
  ctx.fillRect(0, from, width, height - from);

  // The sun's column on the water, broken into ripples.
  ctx.globalCompositeOperation = "screen";
  const columnWidth = width * 0.13;
  for (let i = 0; i < 26; i += 1) {
    const y = from + (i / 26) * (height - from);
    const spread = 1 + (i / 26) * 6;
    const wobble = Math.sin(t * 1.3 + i * 0.5) * width * 0.012;
    ctx.globalAlpha = 0.5 - (i / 26) * 0.38;
    ctx.fillStyle = accent;
    ctx.fillRect(sunX - columnWidth * spread * 0.5 + wobble, y, columnWidth * spread, 2 + (i / 26) * 3);
  }

  ctx.globalAlpha = 0.16;
  ctx.fillStyle = "#ffffff";
  for (let i = 0; i < 40; i += 1) {
    const y = from + pseudo(seed, i) * (height - from);
    const w = width * (0.05 + pseudo(seed + 1, i) * 0.18);
    const x = ((pseudo(seed + 2, i) * width + t * (4 + i % 5)) % (width + w)) - w;
    ctx.fillRect(x, y, w, 1);
  }
  ctx.restore();
}

/**
 * Paint one backdrop. `t` is seconds since it opened; pass 0 for a still.
 */
export function drawBackdrop(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  id: BackdropId = "dusk",
  t = 0,
  seed = 1,
): void {
  const scene = BACKDROPS[id] ?? BACKDROPS.dusk;
  const horizon = height * (id === "coast" ? 0.62 : 0.68);

  // Sky.
  const sky = ctx.createLinearGradient(0, 0, 0, horizon);
  sky.addColorStop(0, scene.sky[0]);
  sky.addColorStop(0.55, scene.sky[1]);
  sky.addColorStop(1, scene.sky[2]);
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, width, height);

  // A haze band right above the horizon, where the light collects.
  const haze = ctx.createLinearGradient(0, horizon - height * 0.18, 0, horizon);
  haze.addColorStop(0, "rgba(0,0,0,0)");
  haze.addColorStop(1, scene.haze);
  ctx.save();
  ctx.globalAlpha = 0.3;
  ctx.fillStyle = haze;
  ctx.fillRect(0, horizon - height * 0.18, width, height * 0.18);
  ctx.restore();

  clouds(ctx, width, height, horizon, id === "neon" ? "#3a1a5c" : "#ffffff", t, seed);
  sun(ctx, width * scene.sun[0], height * scene.sun[1], Math.max(14, Math.min(width, height) * 0.055), scene.accent, t);

  // The city, then the water in front of it.
  skyline(ctx, width, horizon, height, "#0a0714", id === "neon" ? "#7ef4ff" : "#ffd48a", t, seed);
  if (id !== "neon") {
    water(ctx, width, height, horizon, scene.accent, width * scene.sun[0], t, seed);
  } else {
    // Wet asphalt instead of water: the same reflection, flattened.
    ctx.save();
    const road = ctx.createLinearGradient(0, horizon, 0, height);
    road.addColorStop(0, "rgba(8, 6, 18, 0.4)");
    road.addColorStop(1, "rgba(4, 3, 10, 0.92)");
    ctx.fillStyle = road;
    ctx.fillRect(0, horizon, width, height - horizon);
    ctx.globalCompositeOperation = "screen";
    for (let i = 0; i < 18; i += 1) {
      const x = (i / 18) * width;
      ctx.globalAlpha = 0.22 + 0.12 * Math.sin(t * 1.6 + i);
      ctx.fillStyle = i % 3 === 0 ? "#ff4fa3" : i % 3 === 1 ? "#5fe6f0" : "#ffd08a";
      ctx.fillRect(x, horizon + 4, width * 0.012, height * 0.22);
    }
    ctx.restore();
  }

  // Palms in the foreground, the tallest and darkest thing in the frame — they are what makes the
  // silhouette read as a coast rather than as a city.
  const palmColour = "rgba(6, 4, 12, 0.94)";
  palm(ctx, width * 0.06, height * 1.02, height * 0.62, 0.16, palmColour, Math.sin(t * 0.5));
  palm(ctx, width * 0.93, height * 1.03, height * 0.5, -0.2, palmColour, Math.sin(t * 0.5 + 1.2));
  if (id === "coast") {
    palm(ctx, width * 0.78, height * 1.04, height * 0.4, -0.12, palmColour, Math.sin(t * 0.5 + 2.4));
  }
}

/** The backdrop as a standalone canvas — used for the hero, and as the ground of a composite. */
export function backdropCanvas(width: number, height: number, id: BackdropId, t = 0, seed = 1): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(width));
  canvas.height = Math.max(1, Math.round(height));
  const ctx = canvas.getContext("2d");
  if (ctx) drawBackdrop(ctx, canvas.width, canvas.height, id, t, seed);
  return canvas;
}