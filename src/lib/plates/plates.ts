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

export type PlateSource =
  | {
      kind: "photo";
      objectUrl: string;
      name: string;
      /** The place on its own, if the press kept the layers apart: what the surfaces put behind the person. */
      groundUrl?: string;
      /** The person on their own, transparent: what the layer controls move over that ground. */
      subjectUrl?: string;
    }
  | { kind: "plate"; id: string; src: string };

export interface BakedPlate {
  id: string;
  /** Label shown in the picker. */
  label: string;
  /** Short brief line: what this character is for. */
  note: string;
  src: string;
}

/**
 * Baked by the print desk (see docs/print-desk.md). Every face here is fictional, invented by the
 * casting desk (`tools/print-desk/subject.mjs` → SDXL) and restyled by the look spec. The one
 * non-character plate is the proof plate, kept because the end-to-end test uses it.
 */
const ART = `${import.meta.env.BASE_URL}art/demo/`;

export const BAKED_PLATES: BakedPlate[] = [
  {
    id: "marisol",
    label: "Marisol",
    note: "Key-art plate — a clean straight-on shot for the loading screen.",
    src: `${ART}s1-marisol-keyart.jpg`,
  },
  {
    id: "tomas",
    label: "Tomás",
    note: "Key-art plate — wears glasses, so the restyle has to keep them.",
    src: `${ART}s2-tomas-keyart.jpg`,
  },
  {
    id: "elias",
    label: "Elías",
    note: "Key-art plate — weathered face, the hardest likeness case.",
    src: `${ART}s3-elias-keyart.jpg`,
  },
  {
    id: "tomas-press",
    label: "Tomás · press",
    note: "The same face in the photoreal register — what the front page runs.",
    src: `${ART}s2-tomas-press.jpg`,
  },
  {
    id: "placeholder",
    label: "Proof plate",
    note: "The empty desk plate, printed before any run.",
    src: `${ART}placeholder.png`,
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
