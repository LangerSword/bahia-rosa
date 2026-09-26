import { SCENES, SCENE_IDS, sceneSrc } from "../look/scenes";

/**
 * The plates.
 *
 * Nine real frames, and every one of them came out of this app: five printed plates from photographed
 * people, and the four places the press prints into. No stock photography — a gallery of proofs that used
 * a catalogue's pictures would be the one thing on this site that is not evidence.
 *
 * Pure data, so the composition can be tested without a browser: which frames, what they say, and how they
 * divide into columns.
 */

export interface GalleryFrame {
  src: string;
  /** What the frame is, said plainly — this is also the image's alt text. */
  caption: string;
  width: number;
  height: number;
}

/** Respect the deployed base path: a gallery image is fetched from the same origin as the site. */
function asset(path: string): string {
  const base = (import.meta as unknown as { env?: Record<string, string> }).env?.BASE_URL ?? "/";
  return `${base.replace(/\/$/, "")}${path}`;
}

const PRINTED: GalleryFrame[] = [
  {
    src: asset("/plates/the-marina-at-golden-hour.jpg"),
    caption: "a plate pressed from a photograph of the marina, at golden hour",
    width: 1600,
    height: 900,
  },
  {
    src: asset("/plates/hamilton-at-the-pool.jpg"),
    caption: "a plate pressed from a photograph of a racing driver — the sponsor lettering survives the press",
    width: 1600,
    height: 900,
  },
  {
    src: asset("/plates/the-group-at-the-beach.jpg"),
    caption: "a group, printed as one person-shaped layer",
    width: 1400,
    height: 788,
  },
  {
    src: asset("/plates/one-photograph-pressed.jpg"),
    caption: "a plate pressed from a performer's photograph, printed into the neon street",
    width: 1600,
    height: 900,
  },
  {
    src: asset("/plates/one-photograph-original.jpg"),
    caption: "the same job's source: the photograph as it arrived",
    width: 736,
    height: 1104,
  },
];

const PLACES: GalleryFrame[] = SCENE_IDS.filter((id) => Boolean(SCENES[id].file)).map((id) => ({
  src: sceneSrc(id),
  caption: `the place the press prints into: ${SCENES[id].label.toLowerCase()}`,
  width: 1344,
  height: 768,
}));

export const GALLERY: GalleryFrame[] = [...PRINTED, ...PLACES];

/**
 * Deal the frames into columns the way a contact sheet is dealt — one at a time, left to right — so the
 * columns stay balanced however many frames there are or however narrow the screen gets.
 */
export function splitColumns<T>(items: T[], columns: number): T[][] {
  const count = Math.max(1, Math.floor(columns));
  const out: T[][] = Array.from({ length: count }, () => []);
  items.forEach((item, index) => {
    out[index % count].push(item);
  });
  return out;
}