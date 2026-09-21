import { describe, expect, test } from "vitest";
import { PLACEMENTS, fillCopy, findPlacement, FONT_STACKS } from "../../src/world/placements";

/**
 * The placements are data, so they can be checked like data — before anything is drawn. Every failure
 * this catches is a broken download: artwork hanging off the canvas, a caption drawn under the bezel,
 * a layer that runs off the right edge once the copy is filled in.
 */

const copy = { city: "Bahía Rosa", handle: "@someone-with-a-long-handle", title: "printed at the boulevard", line: "made it myself, out tonight" };

describe("placements", () => {
  test("there are four surfaces, and each one is findable by id", () => {
    expect(PLACEMENTS).toHaveLength(4);
    for (const placement of PLACEMENTS) {
      expect(findPlacement(placement.id)).toBe(placement);
      expect(placement.caption.length).toBeGreaterThan(20);
    }
  });

  test("the artwork sits inside its canvas, and inside its bezel when it has one", () => {
    for (const { artwork, width, height, bezel, id } of PLACEMENTS) {
      expect(artwork.x, id).toBeGreaterThanOrEqual(0);
      expect(artwork.y, id).toBeGreaterThanOrEqual(0);
      expect(artwork.x + artwork.w, id).toBeLessThanOrEqual(width);
      expect(artwork.y + artwork.h, id).toBeLessThanOrEqual(height);
      if (bezel) {
        expect(artwork.x, id).toBeGreaterThanOrEqual(bezel.x);
        expect(artwork.y, id).toBeGreaterThanOrEqual(bezel.y);
        expect(artwork.x + artwork.w, id).toBeLessThanOrEqual(bezel.x + bezel.w);
        expect(artwork.y + artwork.h, id).toBeLessThanOrEqual(bezel.y + bezel.h);
      }
    }
  });

  test("no layer is drawn outside the canvas once the copy is filled in", () => {
    for (const placement of PLACEMENTS) {
      for (const layer of placement.layers) {
        const text = layer.upper ? fillCopy(layer.text, copy).toUpperCase() : fillCopy(layer.text, copy);
        // A conservative width model: canvas letter widths run ~0.62em for the text faces and ~0.75em
        // for the deco display, plus the tracking. Enough to catch a layer that leaves the frame.
        const perChar = layer.size * (layer.family === "display" ? 0.75 : 0.62) + (layer.tracking ?? 0) * layer.size;
        const estimated = text.length * perChar;
        // A maxWidth is a promise the renderer keeps by measuring the real font; the model has to be
        // no wider than that promise, or the box it was promised does not fit the canvas either.
        const width = layer.maxWidth ? Math.min(estimated, layer.maxWidth) : estimated;
        const left = layer.align === "right" ? layer.x - width : layer.align === "center" ? layer.x - width / 2 : layer.x;
        expect(left, `${placement.id}: "${text}" starts off-canvas`).toBeGreaterThanOrEqual(-2);
        expect(left + width, `${placement.id}: "${text}" runs off-canvas`).toBeLessThanOrEqual(placement.width + 2);
        expect(layer.y, `${placement.id}: "${text}" is below the canvas`).toBeLessThanOrEqual(placement.height);
      }
    }
  });

  test("every layer that carries user copy is width-limited", () => {
    // The user can type anything. A layer that draws {handle} with no maxWidth is a download waiting
    // to run off the edge of a 900px canvas.
    for (const placement of PLACEMENTS) {
      for (const layer of placement.layers) {
        if (!/\{(handle|title|line|city)\}/.test(layer.text)) continue;
        expect(layer.maxWidth, `${placement.id}: "${layer.text}" is unbounded`).toBeGreaterThan(0);
        const maxWidth = layer.maxWidth ?? 0;
        const span = layer.align === "right" ? layer.x - maxWidth : layer.x + maxWidth;
        expect(span, `${placement.id}: "${layer.text}" exceeds the canvas`).toBeLessThanOrEqual(placement.width + 2);
        expect(span, `${placement.id}: "${layer.text}" goes negative`).toBeGreaterThanOrEqual(-2);
      }
    }
  });

  test("the copy placeholders are the only dynamic parts", () => {
    const filled = fillCopy("{city} · {handle} · {title} · {line}", copy);
    expect(filled).toBe(`${copy.city} · ${copy.handle} · ${copy.title} · ${copy.line}`);
    expect(filled).not.toContain("{");
  });

  test("every family the layers use has a stack, and the display face is not the body face", () => {
    for (const placement of PLACEMENTS) {
      for (const layer of placement.layers) expect(FONT_STACKS[layer.family]).toBeTruthy();
    }
    expect(FONT_STACKS.display).not.toBe(FONT_STACKS.text);
  });

  test("three night surfaces sit on a city plate behind a scrim; the postcard stays paper", () => {
    const light = PLACEMENTS.filter((placement) => (placement.ground.stops?.[0] ?? "").toLowerCase() === "#f2efe9");
    expect(light.map((placement) => placement.id)).toEqual(["postcard"]);

    const imaged = PLACEMENTS.filter((placement) => placement.ground.kind === "image");
    expect(imaged.map((placement) => placement.id).sort()).toEqual(["billboard", "feed", "venue"]);
    for (const placement of imaged) {
      expect(placement.ground.src, `${placement.id} has no ground plate`).toMatch(/art\/city\/.+\.jpg$/);
      const scrim = placement.ground.scrim;
      expect(scrim?.length, `${placement.id} has no scrim`).toBe(2);
      // The scrim has to end dark: light type over a photograph with no floor is unreadable.
      expect(scrim![1], `${placement.id}'s scrim does not close dark`).toMatch(/0\.8[5-9]|0\.9/);
    }
  });
});
