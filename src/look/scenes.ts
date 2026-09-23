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
    ground: 0.88,
    height: 0.6,
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
    ground: 0.87,
    height: 0.62,
    light: "right",
  },
  rooftop: {
    label: "Rooftop pool",
    blurb: "the city lit up behind you, water glowing",
    file: "rooftop.jpg",
    ground: 0.92,
    height: 0.72,
    light: "behind",
  },
  boulevard: {
    label: "Palm boulevard",
    blurb: "neon on wet asphalt, a long way from here",
    file: "boulevard.jpg",
    ground: 0.91,
    height: 0.68,
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
 * Pure arithmetic, so it is unit-tested: the subject is scaled to the scene's own figure height,
 * anchored to the scene's own ground line, and kept on the side of the frame the photograph put them
 * on (a person on the left of a portrait should not be teleported to the middle of a beach).
 */
export function placeSubject(
  subject: { x: number; y: number; width: number; height: number },
  frame: { width: number; height: number },
  scene: { ground: number; height: number },
  margin = 0.06,
): { x: number; y: number; width: number; height: number } {
  const targetHeight = Math.max(24, frame.height * scene.height);
  const scale = targetHeight / Math.max(1, subject.height);

  const width = subject.width * scale;
  const height = targetHeight;
  const groundY = frame.height * scene.ground;

  // Horizontal: where the subject sat in the frame, expressed as a fraction, then clamped so a person
  // at the very edge is not half off the plate.
  const centreFraction = (subject.x + subject.width / 2) / Math.max(1, frame.width);
  const wanted = frame.width * (centreFraction * 0.6 + 0.5 * 0.5) - width / 2;
  const x = Math.min(Math.max(wanted, frame.width * margin), frame.width - width - frame.width * margin);

  return { x, y: Math.max(0, groundY - height), width, height };
}