/**
 * The story: what happened to a photograph, in three moments.
 *
 * Photo → plate → city is the whole product, and on the city stage the visitor is looking at their own
 * three artefacts: the picture they brought, the plate the press made of it, the place it was printed
 * into. This module holds the arithmetic that walks those three moments as the page scrolls, kept pure so
 * it can be tested without a browser.
 */

export type StoryId = "photograph" | "plate" | "city";

export interface StoryMoment {
  id: StoryId;
  label: string;
  /** What this moment is, said plainly. */
  note: string;
  src: string;
  alt: string;
}

export interface StoryImages {
  photograph: string;
  plate: string;
  city: string;
}

export function storyMoments(images: StoryImages): StoryMoment[] {
  return [
    {
      id: "photograph",
      label: "the photograph",
      note: "What you brought. It stays on this machine — the press runs here, in the page.",
      src: images.photograph,
      alt: "The photograph you brought, before the press",
    },
    {
      id: "plate",
      label: "the plate",
      note: "What the press made of it. The city's light, its ink, its grain — and your face kept.",
      src: images.plate,
      alt: "The plate the press printed from your photograph",
    },
    {
      id: "city",
      label: "the city",
      note: "Where it was printed. The plate is set into Bahía Rosa and published.",
      src: images.city,
      alt: "The place in Bahía Rosa the plate was printed into",
    },
  ];
}

export const STORY_LEAD = 0.12;
export const STORY_TAIL = 0.88;

/**
 * Which moment is on screen at a given scroll progress, and how far into it we are.
 *
 * The walk is between STORY_LEAD and STORY_TAIL so the first moment holds while the section arrives and
 * the last one holds before it leaves — a story that starts mid-scroll or cuts off at the end reads as a
 * glitch rather than a story.
 */
export function storyAt(progress: number, count = 3): { index: number; slice: number } {
  // A NaN arrives as soon as any measurement goes wrong upstream, and a NaN in a transform blanks the
  // section. Treat unreadable progress as "not started": the story opens on the photograph.
  if (!Number.isFinite(progress)) return { index: 0, slice: 0 };
  const clamped = Math.min(1, Math.max(0, progress));
  const span = STORY_TAIL - STORY_LEAD;
  const walked = Math.min(1, Math.max(0, (clamped - STORY_LEAD) / span));
  const scaled = walked * count;
  const index = Math.min(count - 1, Math.floor(scaled));
  return { index, slice: Math.min(1, Math.max(0, scaled - index)) };
}