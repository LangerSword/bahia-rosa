/**
 * The city's surfaces, as data.
 *
 * A placement is one in-world surface an artwork can be launched into. The preview and the exported
 * PNG both read this spec — the preview scales it with CSS, the export draws it on a canvas — so the
 * thing the user sees is the thing they download. Same principle as the look spec: one source, many
 * consumers, no second copy to drift.
 *
 * Numbers are in export pixels. The preview divides by `width` to get its scale factor.
 */

export const PALETTE = {
  canvas: "#07070a",
  ink: "#0d0d12",
  ink2: "#14141a",
  ink3: "#1b1b23",
  paper: "#f2efe9",
  body: "#cecece",
  muted: "#989898",
  faint: "#6f6f6f",
  gold: "#fcaf17",
  danger: "#ef6f6f",
  rule: "rgba(242,239,233,0.14)",
} as const;

export const BACKDROPS = {
  night: ["#16203f", "#0d0c1a"],
  venue: ["#2d1f36", "#0f0c1a"],
  dusk: ["#1f355b", "#161733"],
} as const;

export type Family = "display" | "text" | "kicker" | "script";
export type Align = "left" | "center" | "right";

export interface TextLayer {
  /** `copy` placeholders: {city} {handle} {title} {line} — filled by the caller, never hard-coded. */
  text: string;
  x: number;
  y: number;
  size: number;
  family: Family;
  color: string;
  align?: Align;
  weight?: number;
  tracking?: number;
  /** Hard limit in export pixels; the renderer measures the real font and ellipsises past it. */
  maxWidth?: number;
  /** Uppercase at draw time so the DOM preview and the canvas agree without CSS text-transform. */
  upper?: boolean;
}

export interface Rule {
  x: number;
  y: number;
  w: number;
  h: number;
  color: string;
}

export interface Placement {
  id: string;
  label: string;
  blurb: string;
  width: number;
  height: number;
  /**
   * What the surface sits in front of. `image` is one of the city plates this repo generates for
   * itself (`tools/print-desk/scenery.mjs`) — scenery only, never a person — with a scrim gradient
   * over it so type stays legible.
   */
  ground: {
    kind: "gradient" | "image";
    stops?: readonly [string, string];
    src?: string;
    scrim?: readonly [string, string];
    angle: number;
  };
  artwork: { x: number; y: number; w: number; h: number; fit: "cover" | "contain" };
  /** A plinth/bezel behind the artwork: the object the artwork is printed on. */
  bezel?: { x: number; y: number; w: number; h: number; color: string };
  rules: Rule[];
  layers: TextLayer[];
  /** The text equivalent of the composite, for the DOM and for screen readers. */
  caption: string;
}

/** The city plates, resolved against the app's base path so a sub-path deploy still finds them. */
const city = (name: string): string => `${import.meta.env.BASE_URL}art/city/${name}.jpg`;

export interface PlacementCopy {
  city: string;
  handle: string;
  title: string;
  line: string;
}

const MONO = PALETTE;

/** 8:3 roadside panel on a dusk skyline. */
const billboard: Placement = {
  id: "billboard",
  label: "Roadside billboard",
  blurb: "Eight metres of you, over the boulevard at dusk.",
  width: 1600,
  height: 600,
  ground: { kind: "image", src: city("boulevard"), scrim: ["rgba(7,7,10,0.35)", "rgba(7,7,10,0.9)"], angle: 189 },
  bezel: { x: 0, y: 0, w: 1600, h: 470, color: MONO.ink },
  artwork: { x: 90, y: 40, w: 1420, h: 390, fit: "cover" },
  rules: [
    { x: 90, y: 500, w: 1420, h: 2, color: MONO.gold },
    { x: 0, y: 470, w: 1600, h: 130, color: MONO.ink },
  ],
  layers: [
    { text: "{city} OUTDOOR · NIGHT ROTATION", x: 90, y: 548, size: 26, family: "kicker", color: MONO.faint, tracking: 0.28, upper: true, maxWidth: 900 },
    { text: "{title}", x: 90, y: 462, size: 30, family: "text", color: MONO.body, weight: 500, maxWidth: 1000 },
    { text: "{handle}", x: 1510, y: 548, size: 26, family: "text", color: MONO.gold, align: "right", maxWidth: 560 },
  ],
  caption: "Your artwork on the roadside billboard over the boulevard at dusk.",
};

/** 3:4 portrait LED display in a venue foyer. */
const venue: Placement = {
  id: "venue",
  label: "Venue display",
  blurb: "The foyer screen, running your poster as tonight's bill.",
  width: 900,
  height: 1200,
  ground: { kind: "image", src: city("downtown"), scrim: ["rgba(10,8,14,0.45)", "rgba(7,7,10,0.92)"], angle: 189 },
  bezel: { x: 40, y: 40, w: 820, h: 1020, color: MONO.ink },
  artwork: { x: 90, y: 90, w: 720, h: 900, fit: "cover" },
  rules: [
    { x: 90, y: 1010, w: 720, h: 2, color: MONO.gold },
    { x: 90, y: 1090, w: 720, h: 1, color: MONO.rule },
  ],
  layers: [
    { text: "LA GAVIOTA ARENA", x: 90, y: 1070, size: 34, family: "display", color: MONO.paper, tracking: 0.04 },
    { text: "{line}", x: 810, y: 1070, size: 26, family: "kicker", color: MONO.gold, align: "right", tracking: 0.2, upper: true, maxWidth: 460 },
    { text: "doors 22:00 · floor standing", x: 90, y: 1130, size: 24, family: "text", color: MONO.muted },
    { text: "NO RE-ENTRY · {city}", x: 810, y: 1130, size: 22, family: "text", color: MONO.faint, align: "right", maxWidth: 420 },
  ],
  caption: "Your artwork on the venue's foyer display, billed as tonight's show.",
};

/** 4:5 in-world social post. */
const feed: Placement = {
  id: "feed",
  label: "In-world feed",
  blurb: "Posted to the coast's feed, avatar and all.",
  width: 1080,
  height: 1350,
  ground: { kind: "image", src: city("marina"), scrim: ["rgba(7,7,10,0.25)", "rgba(7,7,10,0.88)"], angle: 189 },
  artwork: { x: 0, y: 210, w: 1080, h: 900, fit: "cover" },
  rules: [
    { x: 0, y: 190, w: 1080, h: 1, color: MONO.rule },
    { x: 0, y: 1110, w: 1080, h: 1, color: MONO.rule },
    { x: 0, y: 1240, w: 1080, h: 1, color: MONO.rule },
  ],
  layers: [
    { text: "{handle}", x: 190, y: 96, size: 40, family: "text", color: MONO.paper, weight: 600, maxWidth: 800 },
    { text: "{city} · now", x: 190, y: 142, size: 28, family: "text", color: MONO.faint, maxWidth: 800 },
    { text: "{line}", x: 60, y: 1190, size: 34, family: "text", color: MONO.body, maxWidth: 960 },
    { text: "2,481 likes · 96 comments", x: 60, y: 1310, size: 28, family: "text", color: MONO.faint },
  ],
  caption: "Your artwork posted to the coast's feed, with your handle and avatar.",
};

/** 3:2 printed postcard — the second download. */
const postcard: Placement = {
  id: "postcard",
  label: "Postcard",
  blurb: "A printed postcard from the coast, stamped and captioned.",
  width: 1500,
  height: 1000,
  ground: { kind: "gradient", stops: [MONO.paper, "#dcd6c8"], angle: 189 },
  bezel: { x: 70, y: 70, w: 1360, h: 620, color: MONO.ink },
  artwork: { x: 90, y: 90, w: 1320, h: 580, fit: "cover" },
  rules: [{ x: 70, y: 740, w: 1360, h: 1, color: "rgba(13,13,18,0.25)" }],
  layers: [
    { text: "{city}", x: 110, y: 880, size: 76, family: "display", color: MONO.ink, tracking: 0.06, upper: true, maxWidth: 820 },
    { text: "{title}", x: 110, y: 930, size: 32, family: "script", color: MONO.ink, maxWidth: 820 },
    { text: "greetings from the coast · {city}", x: 1390, y: 880, size: 26, family: "kicker", color: "rgba(13,13,18,0.55)", align: "right", tracking: 0.2, upper: true, maxWidth: 620 },
    { text: "POST CARD", x: 1390, y: 935, size: 24, family: "text", color: "rgba(13,13,18,0.45)", align: "right" },
  ],
  caption: "Your artwork printed as a postcard from the coast.",
};

export const PLACEMENTS: readonly Placement[] = [billboard, venue, feed, postcard];

export const findPlacement = (id: string): Placement | undefined => PLACEMENTS.find((p) => p.id === id);

/** The avatar the feed draws beside the handle — a small crop of the plate, so it needs no asset. */
export const FEED_AVATAR = { x: 60, y: 66, size: 100 };

/** Fill the copy placeholders. One place, so no consumer invents its own wording. */
export function fillCopy(text: string, copy: PlacementCopy): string {
  return text
    .replaceAll("{city}", copy.city)
    .replaceAll("{handle}", copy.handle)
    .replaceAll("{title}", copy.title)
    .replaceAll("{line}", copy.line);
}

/** Font stacks, shared by the canvas exporter and the DOM preview. */
export const FONT_STACKS: Record<Family, string> = {
  display: '"Limelight", Georgia, serif',
  text: '"Inter", system-ui, -apple-system, sans-serif',
  kicker: '"Poiret One", system-ui, sans-serif',
  script: '"Pinyon Script", cursive',
};
