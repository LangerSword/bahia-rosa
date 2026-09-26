/**
 * Whether the entry plays.
 *
 * The entry is a title sequence: the wordmark assembled letter by letter, a counter reading the real work
 * the page is doing, and a sheet that lifts away to the page. It plays for **every visitor on every
 * visit** — that is a decision, not an oversight: the title is part of the piece, and a piece that shows
 * itself to strangers once and never again is a piece most people never see.
 *
 * What still skips it, and why:
 *
 *   `prefers-reduced-motion`  a visitor who asked not to be moved is not shown moving type;
 *   a `?demo=` link           the tour links exist to show a stage, and tours do not open with a title;
 *   automation                a test runner has nobody watching it and a dozen suites paying for it;
 *   already played            it has run *in this page load* already. A title sequence that can start over
 *                             because a component remounted — a hot reload while iterating, a re-render
 *                             from above — is the same title twice, and the second one is a bug.
 *
 * `?entry=1` forces it even under automation, and is how the suite that *tests* the entry watches it.
 */

export interface EntryContext {
  /** The visitor asked not to be moved. */
  reducedMotion: boolean;
  /** A `?demo=` link — a tour, and tours do not open with a title card. */
  demo: boolean;
  /** A browser under automation, which is not a person arriving. */
  automated: boolean;
  /** `?entry=1` — the one way to overrule the skips above. */
  forced: boolean;
  /** It has already run since this page loaded. */
  played?: boolean;
}

/**
 * Played-once-per-load, held in module scope: a fresh visit is a fresh load, and a remount inside one load
 * is not a fresh visit. Marked when the title *starts*, not when it ends — an intro interrupted by a
 * remount should not begin again from the top, which is the replay this exists to stop.
 */
let played = false;

export function entryHasPlayed(): boolean {
  return played;
}

export function markEntryPlayed(): void {
  played = true;
}

/** Only for tests: forget that it played, so a suite can watch it more than once in a run. */
export function resetEntryPlayed(): void {
  played = false;
}

export function entryShouldPlay(context: EntryContext): boolean {
  if (context.played) return false;
  if (context.forced) return true;
  if (context.reducedMotion) return false;
  if (context.demo) return false;
  if (context.automated) return false;
  return true;
}

/** Read the context off a live page. Kept apart from the decision so the decision can be tested. */
export function readEntryContext(): EntryContext {
  const params = new URLSearchParams(window.location.search);
  return {
    reducedMotion:
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    demo: [...params.keys()].some((key) => key === "demo"),
    automated: typeof navigator !== "undefined" && navigator.webdriver === true,
    forced: params.get("entry") === "1",
    played: entryHasPlayed(),
  };
}