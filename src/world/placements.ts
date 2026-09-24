/**
 * The city's surfaces, as data.
 *
 * A placement is one in-world surface an artwork can be launched into. The preview and the exported
 * PNG both read this spec — the preview scales it with CSS, the export draws it on a canvas — so the
 * thing the user sees is the thing they download. Same principle as the look spec: one source, many
 * consumers, no second copy to drift.
 *
 * Numbers are in export pixels. The preview divides by `width` to get its scale factor.
 *
 * Typesetting: the four surfaces are printed by the same desk as the rest of the site, so they use the
 * same one voice — a monospaced stack, with weight, tracking and size doing the hierarchy. Two things
 * follow, and both are improvements rather than consistency for its own sake:
 *
 *   1. **No font to load.** The decorative faces this spec used to name are retired, which removes a
 *      silent-failure path: `ctx.font` naming a face the document has not loaded draws in a system
 *      fallback *without erroring*, so an export could look like a different product and still pass
 *      every test. A system monospace stack cannot miss.
 *   2. **No invented numbers.** The feed used to print "2,481 likes · 96 comments" — engagement for a
 *      post that does not exist. It says what is true instead: where it was posted, and that it is one
 *      photograph.
 */

export const PALETTE = {
  canvas: "#0a0a0a",
  ink: "#0d0d12",
  ink2: "#14141a",
  ink3: "#1b1b23",
  paper: "#f5f5f5",
  body: "#c9c9c9",
  muted: "#8f8f8f",
  faint: "#6a6a72",
  amber: "#fbbf24",
  danger: "#ef6f6f",
  rule: "rgba(245,245,245,0.14)",
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

const INK = PALETTE;

/**
 * Roadside billboard, 8:3.
 *
 * The artwork is the whole upper panel — inset a hand's width inside its own frame, the way a pasted
 * poster sits inside a hoarding — and every word lives in one band underneath, on one baseline grid:
 * masthead, title, handle, meta. The old version threaded three text layers through the artwork's
 * bottom edge, which is what made it read as a template rather than a printed panel.
 */
const billboard: Placement = {
  id: "billboard",
  label: "Roadside billboard",
  blurb: "Eight metres of you, over the boulevard at dusk.",
  width: 1600,
  height: 600,
  ground: { kind: "image", src: city("boulevard"), scrim: ["rgba(10,10,10,0.35)", "rgba(10,10,10,0.9)"], angle: 189 },
  bezel: { x: 0, y: 0, w: 1600, h: 492, color: INK.ink },
  artwork: { x: 30, y: 28, w: 1540, h: 436, fit: "cover" },
  rules: [
    // The hoarding's own edge, then the amber rule that divides panel from caption.
    { x: 0, y: 492, w: 1600, h: 3, color: INK.amber },
    { x: 0, y: 495, w: 1600, h: 1, color: "rgba(0,0,0,0.5)" },
  ],
  layers: [
    { text: "LA GAVIOTA", x: 44, y: 552, size: 24, family: "kicker", color: INK.faint, tracking: 0.34, upper: true, maxWidth: 420 },
    { text: "{title}", x: 44, y: 588, size: 40, family: "display", color: INK.paper, weight: 500, maxWidth: 1060 },
    { text: "{line}", x: 1560, y: 552, size: 24, family: "text", color: INK.muted, align: "right", maxWidth: 900 },
    { text: "{handle}", x: 1560, y: 588, size: 34, family: "text", color: INK.amber, weight: 600, align: "right", maxWidth: 620 },
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
  ground: { kind: "image", src: city("downtown"), scrim: ["rgba(12,10,16,0.45)", "rgba(10,10,10,0.92)"], angle: 189 },
  bezel: { x: 36, y: 36, w: 828, h: 972, color: INK.ink },
  artwork: { x: 60, y: 60, w: 780, h: 924, fit: "cover" },
  rules: [
    { x: 36, y: 1032, w: 828, h: 1, color: INK.rule },
    { x: 36, y: 1168, w: 828, h: 1, color: INK.rule },
  ],
  layers: [
    { text: "LA GAVIOTA ARENA", x: 36, y: 1096, size: 46, family: "display", color: INK.paper, weight: 500, tracking: 0.03, maxWidth: 560 },
    { text: "{line}", x: 864, y: 1096, size: 24, family: "kicker", color: INK.amber, align: "right", tracking: 0.22, upper: true, maxWidth: 420 },
    { text: "doors 22:00 · floor standing", x: 36, y: 1150, size: 22, family: "text", color: INK.muted, maxWidth: 460 },
    { text: "no re-entry · {city}", x: 864, y: 1150, size: 20, family: "text", color: INK.faint, align: "right", upper: true, maxWidth: 420 },
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
  ground: { kind: "image", src: city("marina"), scrim: ["rgba(10,10,10,0.25)", "rgba(10,10,10,0.9)"], angle: 189 },
  artwork: { x: 0, y: 180, w: 1080, h: 900, fit: "cover" },
  rules: [
    { x: 0, y: 180, w: 1080, h: 1, color: INK.rule },
    { x: 0, y: 1080, w: 1080, h: 1, color: INK.rule },
  ],
  layers: [
    { text: "{handle}", x: 192, y: 104, size: 44, family: "text", color: INK.paper, weight: 600, maxWidth: 800 },
    { text: "{city} · now", x: 192, y: 146, size: 26, family: "text", color: INK.faint, maxWidth: 800 },
    { text: "{title}", x: 60, y: 1160, size: 40, family: "display", color: INK.paper, weight: 500, maxWidth: 960 },
    { text: "{line}", x: 60, y: 1212, size: 26, family: "text", color: INK.muted, maxWidth: 960 },
    // No invented engagement: what is true about this post is where it came from and that it is yours.
    { text: "posted from {city} · one photograph · tonight", x: 60, y: 1290, size: 22, family: "kicker", color: INK.faint, tracking: 0.12, maxWidth: 960 },
  ],
  caption: "Your artwork posted to the coast's feed, with your handle and avatar.",
};

/**
 * 3:2 printed postcard — the second download.
 *
 * Mounted print on card, addressed side implied: the photograph in a dark mount, a postal rule, the
 * city set large, and a stamp in the corner. The stamp is drawn from three rects and a word, so it
 * needs no asset.
 */
const postcard: Placement = {
  id: "postcard",
  label: "Postcard",
  blurb: "A printed postcard from the coast, stamped and captioned.",
  width: 1500,
  height: 1000,
  ground: { kind: "gradient", stops: [PALETTE.paper, "#ddd8cc"], angle: 189 },
  bezel: { x: 70, y: 70, w: 1360, h: 620, color: INK.ink },
  artwork: { x: 88, y: 88, w: 1324, h: 584, fit: "cover" },
  rules: [
    // The postal rule: a thick line with a hairline under it, the way a card divides its two halves.
    { x: 70, y: 730, w: 1360, h: 2, color: INK.ink },
    { x: 70, y: 736, w: 1360, h: 1, color: "rgba(13,13,18,0.35)" },
    // The stamp: a frame, a perforation line, and the city's postmark square.
    { x: 1310, y: 780, w: 120, h: 150, color: INK.ink },
    { x: 1318, y: 788, w: 104, h: 134, color: "#f9f6ef" },
    { x: 1346, y: 812, w: 48, h: 1, color: "rgba(13,13,18,0.4)" },
    { x: 1346, y: 876, w: 48, h: 1, color: "rgba(13,13,18,0.4)" },
  ],
  layers: [
    { text: "{city}", x: 96, y: 872, size: 84, family: "display", color: INK.ink, weight: 500, tracking: 0.02, upper: true, maxWidth: 1080 },
    { text: "{title}", x: 96, y: 926, size: 32, family: "text", color: "rgba(13,13,18,0.72)", maxWidth: 1080 },
    { text: "greetings from the coast", x: 96, y: 964, size: 22, family: "kicker", color: "rgba(13,13,18,0.5)", tracking: 0.24, upper: true, maxWidth: 700 },
    { text: "{handle}", x: 96, y: 700, size: 24, family: "text", color: "rgba(13,13,18,0.6)", maxWidth: 700 },
    { text: "POST CARD", x: 96, y: 776, size: 20, family: "kicker", color: "rgba(13,13,18,0.45)", tracking: 0.3, upper: true, maxWidth: 300 },
    { text: "POST", x: 1346, y: 840, size: 22, family: "kicker", color: "rgba(13,13,18,0.6)", tracking: 0.14, upper: true, maxWidth: 100 },
    { text: "22:00", x: 1346, y: 868, size: 20, family: "text", color: "rgba(13,13,18,0.5)", maxWidth: 100 },
  ],
  caption: "Your artwork printed as a postcard from the coast.",
};

export const PLACEMENTS: readonly Placement[] = [billboard, venue, feed, postcard];

export const findPlacement = (id: string): Placement | undefined => PLACEMENTS.find((p) => p.id === id);

/** The avatar the feed draws beside the handle — a small crop of the plate, so it needs no asset. */
export const FEED_AVATAR = { x: 56, y: 60, size: 104 };

/** Fill the copy placeholders. One place, so no consumer invents its own wording. */
export function fillCopy(text: string, copy: PlacementCopy): string {
  return text
    .replaceAll("{city}", copy.city)
    .replaceAll("{handle}", copy.handle)
    .replaceAll("{title}", copy.title)
    .replaceAll("{line}", copy.line);
}

/**
 * One stack, four roles.
 *
 * The names are kept (`display`, `text`, `kicker`, `script`) so the specs and the tests read the same,
 * but they all resolve to the mono stack now: hierarchy comes from the size, the weight and the
 * tracking recorded on each layer. Nothing has to be loaded, so nothing can silently fall back.
 */
const MONO_STACK = 'ui-monospace, "JetBrains Mono", "SF Mono", "Cascadia Mono", Menlo, Consolas, monospace';

export const FONT_STACKS: Record<Family, string> = {
  display: MONO_STACK,
  text: MONO_STACK,
  kicker: MONO_STACK,
  script: MONO_STACK,
};