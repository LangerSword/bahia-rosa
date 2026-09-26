import { describe, expect, it } from "vitest";
import { MAGNET_RADIUS, magnetPull, type Magnet } from "../../src/lib/magnet";

const magnet = (id: string, left: number, top: number, width = 100, height = 40): Magnet => ({
  id,
  rect: { left, top, width, height },
});

describe("the magnet", () => {
  it("pulls toward a magnet's middle when the pointer is inside it", () => {
    // Pointer inside the rect (0..100 × 40..80) but above its middle: the ring must lean down and right.
    const pull = magnetPull(20, 45, [magnet("a", 0, 40, 100, 40)]);
    expect(pull.id).toBe("a");
    expect(pull.dx).toBeGreaterThan(0);
    expect(pull.dy).toBeGreaterThan(0);
    expect(pull.strength).toBeCloseTo(1, 5);
  });

  it("says nothing when there is nothing near", () => {
    const pull = magnetPull(900, 900, [magnet("a", 0, 40)]);
    expect(pull).toEqual({ dx: 0, dy: 0, id: null, strength: 0 });
  });

  it("falls off with distance and stops at the rim of the field", () => {
    const rect = magnet("a", 0, 40, 100, 40);
    const near = magnetPull(60, 100, [rect]); // 20px below the rect
    const far = magnetPull(60, 40 + 40 + MAGNET_RADIUS - 2, [rect]);
    expect(near.strength).toBeGreaterThan(far.strength);
    expect(far.strength).toBeGreaterThan(0);
    expect(far.strength).toBeLessThan(0.05);
    expect(magnetPull(60, 40 + 40 + MAGNET_RADIUS + 1, [rect]).id).toBeNull();
  });

  it("follows the nearest magnet, not the biggest or the first", () => {
    const pull = magnetPull(230, 60, [magnet("far", 0, 40), magnet("near", 200, 40)]);
    expect(pull.id).toBe("near");
  });

  it("never lets the ring fly off the pointer", () => {
    const pull = magnetPull(300, 200, [magnet("a", 0, 0, 120, 40), magnet("b", 299, 199, 40, 40)]);
    const travel = Math.hypot(pull.dx, pull.dy);
    expect(travel).toBeLessThanOrEqual(22);
  });

  it("survives a pointer exactly on the middle", () => {
    const pull = magnetPull(50, 60, [magnet("a", 0, 40, 100, 40)]);
    expect(pull.dx).toBe(0);
    expect(pull.dy).toBe(0);
    expect(pull.strength).toBe(1);
  });
});