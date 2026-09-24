import { describe, expect, it } from "vitest";
import { LAYER_DEFAULT, fitRect, isDefaultLayer, layerGeometry, type LayerTransform } from "../../src/world/compose";

/**
 * The subject as a layer, as arithmetic.
 *
 * Everything the interface does — drag, size, cut, overflow — is this function, so this is where the
 * behaviour is decided and where it is tested. The canvas only draws the answer.
 *
 * The first test is the important one: with nothing changed, the geometry must be *exactly* the fit the
 * placements used before layers existed, or every existing surface silently shifts.
 */

const image = { width: 800, height: 600 };
const rect = { x: 100, y: 50, w: 400, h: 300 };
const withLayer = (patch: Partial<LayerTransform>): LayerTransform => ({ ...LAYER_DEFAULT, ...patch });

describe("the layer", () => {
  it("with nothing changed, it is exactly the fit it always was", () => {
    const geometry = layerGeometry(image, rect, LAYER_DEFAULT, "contain");

    expect(geometry.source).toEqual({ x: 0, y: 0, w: 800, h: 600 });
    expect(geometry.destination).toEqual(fitRect(image, rect, "contain"));
    expect(isDefaultLayer(LAYER_DEFAULT)).toBe(true);
    expect(isDefaultLayer(undefined)).toBe(true);
    expect(isDefaultLayer(withLayer({ dx: 0.2 }))).toBe(false);
    expect(isDefaultLayer(withLayer({ overflow: true }))).toBe(false);
  });

  it("a drag moves it by a fraction of the surface, not by pixels", () => {
    const base = layerGeometry(image, rect, withLayer({ scale: 0.5 }), "contain");
    const moved = layerGeometry(image, rect, withLayer({ dx: 0.25, dy: -0.15, scale: 0.5 }), "contain");

    // A quarter of a 400-wide surface is 100px and 0.15 of a 300-tall one is 45px — the same gesture on a
    // postcard and on a billboard. Kept inside the slack on purpose: a drag that reaches the edge is the
    // clamping test below, not this one.
    expect(moved.destination.x - base.destination.x).toBeCloseTo(100, 6);
    expect(moved.destination.y - base.destination.y).toBeCloseTo(-45, 6);
  });

  it("at the fit size there is no slack, so a drag cannot move it while it is held inside", () => {
    // A layer that exactly fills the surface has nowhere to go: clamping is the honest answer, not a
    // half-move that stops at the edge. This is also why the interface offers overflow — letting the layer
    // run off the edge is how you move it at the fitted size, and how part of a body is left out of frame.
    const held = layerGeometry(image, rect, withLayer({ dx: 0.25 }), "contain");
    expect(held.destination.x).toBeCloseTo(rect.x, 6);

    const loose = layerGeometry(image, rect, withLayer({ dx: 0.25, overflow: true }), "contain");
    expect(loose.destination.x - rect.x).toBeCloseTo(100, 6);
  });

  it("the size multiplies the fit and keeps the proportions", () => {
    const base = layerGeometry(image, rect, LAYER_DEFAULT, "contain");
    const bigger = layerGeometry(image, rect, withLayer({ scale: 2 }), "contain");

    expect(bigger.destination.w).toBeCloseTo(base.destination.w * 2, 6);
    expect(bigger.destination.h).toBeCloseTo(base.destination.h * 2, 6);
    expect(bigger.destination.w / bigger.destination.h).toBeCloseTo(image.width / image.height, 6);
  });

  it("cutting takes pixels away rather than squashing what is left", () => {
    const cut = layerGeometry(image, rect, withLayer({ cropBottom: 0.25 }), "contain");
    expect(cut.source).toEqual({ x: 0, y: 0, w: 800, h: 450 });
    // The fit uses the aspect of what survived, so nobody is stretched by the cut.
    expect(cut.destination.w / cut.destination.h).toBeCloseTo(800 / 450, 6);

    const trimmed = layerGeometry(image, rect, withLayer({ cropTop: 0.2, cropBottom: 0.2 }), "contain");
    expect(trimmed.source.y).toBe(120);
    expect(trimmed.source.h).toBe(360);
  });

  it("holds the layer inside the surface unless overflow is asked for", () => {
    const held = layerGeometry(image, rect, withLayer({ dx: 5 }), "contain");
    expect(held.destination.x).toBeGreaterThanOrEqual(rect.x);
    expect(held.destination.x + held.destination.w).toBeLessThanOrEqual(rect.x + rect.w + 1e-6);

    // The same drag, allowed to run past the edge — which is how part of a body is shown on purpose.
    const loose = layerGeometry(image, rect, withLayer({ dx: 5, overflow: true }), "contain");
    expect(loose.destination.x).toBeGreaterThan(rect.x + rect.w);
  });

  it("a layer bigger than the surface is centred rather than clamped to nonsense", () => {
    const huge = layerGeometry(image, rect, withLayer({ scale: 4, dx: 1 }), "contain");
    expect(huge.destination.x).toBeCloseTo(rect.x + (rect.w - huge.destination.w) / 2, 6);
    expect(huge.destination.y).toBeCloseTo(rect.y + (rect.h - huge.destination.h) / 2, 6);
  });

  it("clamps the cuts so a layer can never be cut away to nothing", () => {
    const absurd = layerGeometry(image, rect, withLayer({ cropTop: 0.9, cropBottom: 0.9 }), "contain");
    expect(absurd.source.h).toBeGreaterThanOrEqual(1);
    const negative = layerGeometry(image, rect, withLayer({ cropTop: -1, scale: 0 }), "contain");
    expect(negative.source.y).toBe(0);
    expect(negative.destination.w).toBeGreaterThan(0);
  });
});
