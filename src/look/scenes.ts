/**
 * The city's locations — real images, not gradients.
 *
 * Each scene is a plate generated once by the local model (`tools/print-desk/scenes.mjs`), committed
 * with the repo, and used as the ground the subject is placed into. The numbers beside each one are
 * how a person stands in it: `ground` is where their feet land as a fraction of the frame, and
 * `height` is how much of the frame they should occupy — a figure on the sand is smaller than one by
 * a rooftop pool, and getting that wrong is what makes a composite look pasted.
 */

export type SceneId = "beach" | "mall" | "marina" | "rooftop" | "boulevard";

export interface Scene {
  label: string;
  blurb: string;
  /** File under public/art/scenes. */
  file: string;
  /** Where the subject's feet land, as a fraction of the frame height. */
  ground: number;
  /** How much of the frame height the subject should occupy. */
  height: number;
  /** Which way the light comes from, so the rim light and the shadow agree with the plate. */
  light: "left" | "right" | "behind";
  /** Kept in the repo but not offered: this plate failed the no-people check. */
  withheld?: boolean;
}

export const SCENES: Record<SceneId, Scene> = {
  beach: {
    label: "Bahía beach",
    blurb: "golden hour on the sand, the towers behind you",
    file: "beach.jpg",
    ground: 0.94,
    height: 0.84,
    light: "behind",
  },
  mall: {
    label: "Neon promenade",
    blurb: "storefronts on, the pavement still wet",
    file: "mall.jpg",
    ground: 0.9,
    height: 0.66,
    light: "left",
    // Pulled from the picker: the detector found a face in both takes of this plate, and a stranger
    // baked into the backdrop is precisely the thing the press exists to avoid. The image stays in the
    // repo so a better take can take its place.
    withheld: true,
  },
  marina: {
    label: "The marina",
    blurb: "yachts and masts, sun going down over the water",
    file: "marina.jpg",
    ground: 0.94,
    height: 0.86,
    light: "right",
  },
  rooftop: {
    label: "Rooftop pool",
    blurb: "the city lit up behind you, water glowing",
    file: "rooftop.jpg",
    ground: 0.95,
    height: 0.88,
    light: "behind",
  },
  boulevard: {
    label: "Palm boulevard",
    blurb: "neon on wet asphalt, a long way from here",
    file: "boulevard.jpg",
    ground: 0.95,
    height: 0.87,
    light: "left",
  },
};

export const SCENE_IDS = (Object.keys(SCENES) as SceneId[]).filter((id) => !SCENES[id].withheld);

/** Resolved against the app's base path, so a sub-path deploy still finds the plates. */
export function sceneSrc(id: SceneId): string {
  const base = (import.meta as unknown as { env?: Record<string, string> }).env?.BASE_URL ?? "/";
  return `${base}art/scenes/${SCENES[id].file}`;
}

/**
 * Where the painted subject goes.
 *
 * Three rules, all of them from the brief:
 *
 *   1. **The subject's own aspect ratio is preserved.** The painted crop carries a margin around the
 *      subject; placing the *subject's* box and then drawing the *crop* into it squashes the margin and
 *      visibly stretches the person. So the crop is what gets placed, and the subject's height inside
 *      it sets the scale.
 *   2. **Size up.** The subject fills `scene.height` of the frame — a presence, not a sticker.
 *   3. **Connected to centre-bottom.** The subject is centred horizontally, and their feet sit on the
 *      bottom edge of the frame. Always, for every scene: no scene-specific ground line to get wrong.
 *
 * Pure arithmetic, so it is unit-tested.
 */
export function placeSubject(
  subject: { x: number; y: number; width: number; height: number },
  crop: { x: number; y: number; width: number; height: number },
  scene: { height: number },
  out: { width: number; height: number },
  margin = 0.04,
): { x: number; y: number; width: number; height: number } {
  // Height does the sizing: the subject fills `scene.height` of the frame.
  const heightScale = (out.height * scene.height) / Math.max(1, subject.height);

  // But never wider than the frame — and the *subject* is what has to fit, not the crop that carries it.
  // Capping by the crop was the subtler half of the same mistake: the crop has margins of its own, so a
  // subject sitting near the crop's edge still ran past the frame's. The crop's extra margin can spill
  // off the frame harmlessly — it is transparent where the mask did not cut — but a person cannot.
  const widthScale = (out.width * (1 - margin * 2)) / Math.max(1, subject.width);
  const scale = Math.min(heightScale, widthScale);

  // The subject's centre, measured inside the crop, lands on the frame's centre line.
  const subjectCentreInCrop = subject.x - crop.x + subject.width / 2;
  const x = out.width / 2 - subjectCentreInCrop * scale;

  // The subject's feet, measured inside the crop, land on the frame's bottom edge.
  const feetInCrop = subject.y - crop.y + subject.height;
  const y = out.height - feetInCrop * scale;

  return { x, y, width: crop.width * scale, height: crop.height * scale };
}