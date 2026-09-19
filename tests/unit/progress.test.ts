import { describe, expect, test } from "vitest";
import { progressFromEvent } from "../../src/lib/printdesk/client";

/**
 * The bar's job is to be believable. A regression here is not cosmetic: with the quality preset
 * (26 steps) divided by the spec's 4 steps, the bar reported 440% and the run looked broken.
 */
describe("print progress", () => {
  test("26 steps stay inside the bar", () => {
    for (const value of [1, 5, 13, 25, 26]) {
      const progress = progressFromEvent({ type: "progress", data: { value, max: 26 } }, 26);
      expect(progress).not.toBeNull();
      expect(progress!.percent).toBeGreaterThan(0.2);
      expect(progress!.percent).toBeLessThanOrEqual(0.85);
      expect(progress!.steps).toBe(26);
    }
  });

  test("the event's own max wins over a stale step count", () => {
    // The desk says 26; the spec still says 4. Trusting the spec is what overflowed the bar.
    const progress = progressFromEvent({ type: "progress", data: { value: 26, max: 26 } }, 4);
    expect(progress!.percent).toBeLessThanOrEqual(0.85);
    expect(progress!.steps).toBe(26);
  });

  test("progress is monotonic and never exceeds the sampling share", () => {
    let previous = 0;
    for (const value of [0, 1, 2, 3, 4]) {
      const progress = progressFromEvent({ type: "progress", data: { value, max: 4 } }, 4)!;
      expect(progress.percent).toBeGreaterThanOrEqual(previous);
      previous = progress.percent;
    }
    expect(previous).toBeLessThanOrEqual(0.85);
  });

  test("a missing max falls back to the given steps instead of dividing by zero", () => {
    const progress = progressFromEvent({ type: "progress", data: { value: 2 } }, 4)!;
    expect(progress.steps).toBe(4);
    expect(Number.isFinite(progress.percent)).toBe(true);
  });

  test("terminal events still read as terminal", () => {
    const done = progressFromEvent({ type: "execution_success" });
    const failed = progressFromEvent({ type: "execution_error", data: { exception_message: "boom" } });
    expect(done?.stage).toBe("done");
    expect(failed?.stage).toBe("failed");
    expect(progressFromEvent({ type: "something-else" })).toBeNull();
  });
});
