import { describe, expect, it } from "vitest";
import { PRESS_TIPS } from "../../src/lib/tips";

describe("the loading screen's tips", () => {
  it("has enough of them to outlast a press", () => {
    expect(PRESS_TIPS.length).toBeGreaterThanOrEqual(4);
  });

  it("says each thing once, and keeps it to a line you can read at a glance", () => {
    expect(new Set(PRESS_TIPS).size).toBe(PRESS_TIPS.length);
    for (const tip of PRESS_TIPS) {
      expect(tip.length).toBeLessThan(130);
      expect(tip.endsWith(".")).toBe(true);
    }
  });
});