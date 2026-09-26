import { describe, expect, it } from "vitest";
import { TEAR_JAGS, TEAR_WIDTH, tearPath } from "../../src/lib/tear";

describe("the tear", () => {
  it("draws the same tear for the same seed, every time", () => {
    expect(tearPath(42, 100)).toBe(tearPath(42, 100));
  });

  it("draws a different tear for a different seed", () => {
    expect(tearPath(42, 100)).not.toBe(tearPath(43, 100));
  });

  it("is a tear, not a rule: the edge leaves the centre line", () => {
    const points = tearPath(42, 100)
      .split(/(?=[ML])/)
      .map((segment) => segment.slice(1).split(",").map(Number));
    const middle = TEAR_WIDTH / 2;
    const offCentre = points.filter(([x]) => Math.abs(x - middle) > 0.6);
    expect(offCentre.length).toBeGreaterThan(TEAR_JAGS / 3);
  });

  it("stays inside its own strip of paper, top to bottom", () => {
    const points = tearPath(7, 240)
      .split(/(?=[ML])/)
      .map((segment) => segment.slice(1).split(",").map(Number));
    expect(points[0][1]).toBe(0);
    expect(points[points.length - 1][1]).toBe(240);
    for (const [x, y] of points) {
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThanOrEqual(TEAR_WIDTH);
      expect(y).toBeGreaterThanOrEqual(0);
      expect(y).toBeLessThanOrEqual(240);
    }
    // The strip must actually climb: no point may be higher than the one before it.
    for (let index = 1; index < points.length; index += 1) {
      expect(points[index][1]).toBeGreaterThan(points[index - 1][1]);
    }
  });

  it("is a valid path a browser can draw", () => {
    const path = tearPath(11, 100);
    expect(path.startsWith("M")).toBe(true);
    expect((path.match(/L/g) || []).length).toBe(TEAR_JAGS);
    // Every command is a move or a line, and every coordinate pair is a real number: the shape a browser
    // gets is what this module promised, not a string that happens to look like a path.
    const commands = path.split(/(?=[ML])/).filter(Boolean);
    expect(commands).toHaveLength(TEAR_JAGS + 1);
    for (const command of commands) {
      expect(command.startsWith("M") || command.startsWith("L"), command).toBe(true);
      const [x, y] = command.slice(1).trim().split(",");
      expect(Number.isFinite(Number(x)), command).toBe(true);
      expect(Number.isFinite(Number(y)), command).toBe(true);
    }
  });
});