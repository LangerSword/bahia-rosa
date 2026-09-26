/**
 * The card's own numbers: which card this is, and when the press ran.
 *
 * Both are derived rather than random. A serial that changes when the page reloads is a "one of one"
 * you can watch stop being one, so the same plate always mints the same serial — from the plate itself,
 * not from the clock. The stamp is the only thing that reads the clock, and it is the real time the
 * plate was finished.
 */

/** djb2. Small, deterministic, and good enough for minting a serial out of a plate. */
function hash(text: string): number {
  let h = 5381;
  for (let i = 0; i < text.length; i += 1) h = ((h << 5) + h + text.charCodeAt(i)) | 0;
  return Math.abs(h);
}

/**
 * A serial for a plate: `№ 482-00217`.
 *
 * The seed is the frame's name, the place it was printed into, and a slice out of the middle of the
 * plate's own bytes. The middle, not the head: two photographs encoded by the same canvas share their
 * first bytes, and a serial that is the same for every plate is not a serial.
 */
export function serialFor(seed: string): string {
  const n = hash(seed);
  const block = String((n % 900) + 100);
  const run = String(n % 100000).padStart(5, "0");
  return `№ ${block}-${run}`;
}

const DAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

/** `pressed 21:04 · sat 26 sep` — local time, spelled out, no locale dependency. */
export function pressStamp(at: Date): string {
  const hh = String(at.getHours()).padStart(2, "0");
  const mm = String(at.getMinutes()).padStart(2, "0");
  return `pressed ${hh}:${mm} · ${DAYS[at.getDay()]} ${at.getDate()} ${MONTHS[at.getMonth()]}`;
}

/**
 * The tip under the card. Loading screens give you something to read while you wait; ours has already
 * finished by the time you see this, so the tip is genuinely a tip — one true sentence about the two
 * doors below it, chosen by the serial so it is stable for a given plate.
 */
export const CARD_TIPS = [
  "the editor takes text, stickers, filters and a crop — it is the door on the right.",
  "the arrangement moves the person, not the picture: the city prints around them.",
  "\"as it is\" prints your photograph in its own shape, nothing cut to fit.",
  "the downloads carry no text and no watermark — what you press is what you keep.",
];

export function tipFor(seed: string): string {
  return CARD_TIPS[hash(seed) % CARD_TIPS.length];
}