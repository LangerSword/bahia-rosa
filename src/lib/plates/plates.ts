/**
 * Plates — where the image the player edits comes from.
 *
 * Two sources, both local, no network, no keys, no quota:
 *  1. `photo`  — the player's own file, used exactly as uploaded (read in the browser via
 *                createObjectURL; it never leaves the page).
 *  2. `plate`  — a press plate baked offline by the print desk (`tools/print-desk/`), which runs
 *                FLUX.2 [klein] 4B on your own GPU. The plates ship in `public/art/demo/`.
 *
 * Why not generate in the browser for every visitor: nano-banana-class restyling needs a real
 * diffusion model. Running it in the page would mean shipping gigabytes and minutes of compute;
 * running it server-side would mean an API key that can die mid-judging. So generation is a
 * build-time/local activity and the *live* experience is the editorial work — which is exactly
 * what React Image Editor is for, and what the challenge asks to be judged on.
 */

export type PlateSource = { kind: "photo"; objectUrl: string; name: string } | { kind: "plate"; id: string; src: string };

export interface BakedPlate {
  id: string;
  /** Label shown in the picker. */
  label: string;
  /** Short brief line: what this character is for. */
  note: string;
  src: string;
}

/** Baked at build time by the print desk; see public/plates/README.md. */
export const BAKED_PLATES: BakedPlate[] = [
  {
    id: "placeholder",
    label: "Press plate",
    note: "The proof plate the desk prints before a run.",
    src: `${import.meta.env.BASE_URL}art/demo/placeholder.png`,
  },
];

export const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;

export function describeUploadProblem(file: File): string | null {
  if (!file.type.startsWith("image/")) return `"${file.name}" is not an image.`;
  if (file.size > MAX_UPLOAD_BYTES) return `"${file.name}" is over 20 MB — try a smaller file.`;
  return null;
}

export function plateFromFile(file: File): PlateSource {
  return { kind: "photo", objectUrl: URL.createObjectURL(file), name: file.name };
}

export function plateFromBaked(plate: BakedPlate): PlateSource {
  return { kind: "plate", id: plate.id, src: plate.src };
}
