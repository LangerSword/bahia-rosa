import { describe, expect, it } from "vitest";
import { entryShouldPlay, type EntryContext } from "../../src/lib/entry";

const quiet: EntryContext = {
  reducedMotion: false,
  seenThisSession: false,
  demo: false,
  automated: false,
  forced: false,
};

describe("the entry", () => {
  it("plays for a person arriving for the first time", () => {
    expect(entryShouldPlay(quiet)).toBe(true);
  });

  it("never plays for someone who asked not to be moved", () => {
    expect(entryShouldPlay({ ...quiet, reducedMotion: true })).toBe(false);
  });

  it("does not play twice in the same session", () => {
    expect(entryShouldPlay({ ...quiet, seenThisSession: true })).toBe(false);
  });

  it("stays out of the way of the suites, unless it is the suite testing it", () => {
    // Every other spec in tests/e2e depends on this: a title card that blocks clicks would cost each of
    // them seconds and a class of flaky failures, so automation is skipped — and `?entry=1` overrules
    // even that, which is how the entry's own spec gets to watch it.
    expect(entryShouldPlay({ ...quiet, automated: true })).toBe(false);
    expect(entryShouldPlay({ ...quiet, automated: true, forced: true })).toBe(true);
  });

  it("skips the demo links", () => {
    expect(entryShouldPlay({ ...quiet, demo: true })).toBe(false);
  });
});