/**
 * Whether the entry plays.
 *
 * The entry is a title sequence: the wordmark assembled out of letters, a counter reading the real work
 * the page is doing, and a sheet that lifts. It is theatre for a person who has just arrived — so it is
 * not played for anyone who has asked not to be moved (`prefers-reduced-motion`), for a session that has
 * already watched it (making someone sit through the same title twice is how an entry becomes an
 * obstacle), or for a test runner, which has no one watching it and a dozen suites paying for it.
 *
 * `?entry=1` forces it even there, and is how the suite that *tests* the entry asks for it. Any `?demo=`
 * link skips it, like the other demo links on the site.
 */

export const ENTRY_SEEN_KEY = "bahia-rosa.entered.v1";

export interface EntryContext {
  /** The visitor asked not to be moved. */
  reducedMotion: boolean;
  /** This session has already watched the title. */
  seenThisSession: boolean;
  /** A `?demo=` link — the tour, and tours do not open with a title card. */
  demo: boolean;
  /** A browser under automation, which is not a person arriving. */
  automated: boolean;
  /** `?entry=1` — the one way to overrule all of the above. */
  forced: boolean;
}

export function entryShouldPlay(context: EntryContext): boolean {
  if (context.forced) return true;
  if (context.reducedMotion) return false;
  if (context.demo) return false;
  if (context.automated) return false;
  return !context.seenThisSession;
}

/** Read the context off a live page. Kept apart from the decision so the decision can be tested. */
export function readEntryContext(): EntryContext {
  const params = new URLSearchParams(window.location.search);
  const reduced =
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  let seen = false;
  try {
    seen = window.sessionStorage.getItem(ENTRY_SEEN_KEY) === "1";
  } catch {
    // Storage can be disabled. Then the title cannot be remembered, and a title that plays on every
    // page load is worse than no title: treat unreadable storage as "already seen".
    seen = true;
  }
  return {
    reducedMotion: reduced,
    seenThisSession: seen,
    demo: [...params.keys()].some((key) => key === "demo"),
    automated: typeof navigator !== "undefined" && navigator.webdriver === true,
    forced: params.get("entry") === "1",
  };
}

/** Remember that the title has played, for the rest of this tab. */
export function markEntrySeen(): void {
  try {
    window.sessionStorage.setItem(ENTRY_SEEN_KEY, "1");
  } catch {
    // Nothing to do about it, and nothing depends on it having worked.
  }
}