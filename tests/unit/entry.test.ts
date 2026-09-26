import { afterEach, describe, expect, it } from "vitest";
import {
  entryHasPlayed,
  entryShouldPlay,
  markEntryPlayed,
  resetEntryPlayed,
  type EntryContext,
} from "../../src/lib/entry";

/** A person arriving in a browser, with their own motion preferences. */
const person: EntryContext = {
  reducedMotion: false,
  demo: false,
  automated: false,
  forced: false,
};

describe("the entry", () => {
  afterEach(() => {
    resetEntryPlayed();
  });

  it("plays for every visitor, on every visit", () => {
    // The title is part of the piece. There is no "seen it already" state to consult, so a returning
    // visitor gets the same opening as a first-timer — which is the requirement, encoded. The one thing
    // that stops it is having *already run* in this page load (below).
    expect(entryShouldPlay({ ...person })).toBe(true);
    expect(entryShouldPlay({ ...person, played: false })).toBe(true);
  });

  it("never plays for someone who asked not to be moved", () => {
    expect(entryShouldPlay({ ...person, reducedMotion: true })).toBe(false);
  });

  it("stays out of the way of the suites, unless it is the suite testing it", () => {
    // Every other spec in tests/e2e depends on this: a title card that blocks clicks would cost each of
    // them seconds and a class of flaky failures, so automation is skipped — and `?entry=1` overrules
    // even that, which is how the entry's own spec gets to watch it.
    expect(entryShouldPlay({ ...person, automated: true })).toBe(false);
    expect(entryShouldPlay({ ...person, automated: true, forced: true })).toBe(true);
  });

  it("skips the demo links", () => {
    expect(entryShouldPlay({ ...person, demo: true })).toBe(false);
  });

  it("never plays twice in one page load — not even when forced, not after a remount", () => {
    // The bug this covers: the title could start over when the component remounted — a hot reload while
    // iterating, any re-render that recreated the tree — so the visitor got the whole intro a second time.
    expect(entryShouldPlay({ ...person, played: true })).toBe(false);
    expect(entryShouldPlay({ ...person, played: true, forced: true })).toBe(false);
  });

  it("marks it started, not finished: an interrupted intro does not begin from the top", () => {
    expect(entryHasPlayed()).toBe(false);
    markEntryPlayed();
    expect(entryHasPlayed()).toBe(true);
    // The wiring is `readEntryContext()` passing `played` in — the decision itself stays pure, so a caller
    // that forgets the field is a caller that has to be told, not silently obeyed.
    expect(entryShouldPlay({ ...person, played: entryHasPlayed() })).toBe(false);
    expect(entryShouldPlay({ ...person, played: entryHasPlayed(), automated: true, forced: true })).toBe(false);
    resetEntryPlayed();
    expect(entryHasPlayed()).toBe(false);
    expect(entryShouldPlay({ ...person, played: entryHasPlayed() })).toBe(true);
  });
});