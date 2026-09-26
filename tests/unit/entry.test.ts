import { describe, expect, it } from "vitest";
import { entryShouldPlay, type EntryContext } from "../../src/lib/entry";

/** A person arriving in a browser, with their own motion preferences. */
const person: EntryContext = {
  reducedMotion: false,
  demo: false,
  automated: false,
  forced: false,
};

describe("the entry", () => {
  it("plays for every visitor, on every visit", () => {
    // The title is part of the piece. There is no "seen it already" state to consult, so a returning
    // visitor gets the same opening as a first-timer — which is the requirement, encoded.
    expect(entryShouldPlay({ ...person })).toBe(true);
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
});