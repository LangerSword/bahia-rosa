import { describe, expect, test } from "vitest";
import look from "../../src/look/look.json";
import {
  assertSafe,
  compile,
  compileForSurface,
  pick,
  plateFilename,
} from "../../src/look/compile.mjs";

/**
 * The look spec is the project's art direction and its compliance gate, so it gets tested like
 * both: every register must compile, and no compiled prompt may ever carry a prohibited term.
 */

const spec = look;

describe("compile", () => {
  test("compiles every register", () => {
    for (const register of Object.keys(spec.registers)) {
      if (register === "note") continue;
      const out = compile(spec, { register, seed: 42 });
      expect(out.prompt.length).toBeGreaterThan(200);
      expect(out.register).toBe(register);
      expect(out.seed).toBe(42);
    }
  });

  test("identity rules are always present, in the register's own words", () => {
    const out = compile(spec, { register: "key-art", seed: 1 });
    expect(out.prompt).toContain("recognisable");
    expect(out.prompt).toContain("Keep glasses if worn");
    expect(out.prompt).toMatch(/do not beautify the subject into a different person/i);
  });

  test("the approval tail is always present", () => {
    const out = compile(spec, { register: "press-photo", seed: 1 });
    expect(out.prompt).toContain("Original fan-made artwork");
    expect(out.prompt).toContain("no watermark");
  });

  test("carries no prohibited term", () => {
    for (const register of Object.keys(spec.registers)) {
      if (register === "note") continue;
      const { prompt } = compile(spec, { register, seed: 7 });
      for (const term of spec.compliance.prohibited) {
        expect(prompt.toLowerCase()).not.toContain(term.toLowerCase());
      }
    }
  });

  test("honours the declared prompt order", () => {
    const { prompt } = compile(spec, { register: "neon-night", seed: 3 });
    const positions = ["Medium:", "Subject:", "Lighting:", "Palette:", "Camera:", "Finish:"].map((marker) =>
      prompt.indexOf(marker),
    );
    expect(positions.every((p) => p >= 0)).toBe(true);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
  });

  test("is deterministic for a fixed seed and non-deterministic without one", () => {
    expect(compile(spec, { register: "key-art", seed: 5 }).prompt).toBe(
      compile(spec, { register: "key-art", seed: 5 }).prompt,
    );
    expect(compile(spec, { register: "key-art", seed: 5 }).seed).toBe(5);
    expect(compile(spec, { register: "key-art" }).seed).not.toBe(5);
  });

  test("overrides beat register defaults", () => {
    const out = compile(spec, { register: "key-art", lighting: "dusk-neon", palette: "neon-wet", seed: 1 });
    expect(out.lighting).toBe("dusk-neon");
    expect(out.palette).toBe("neon-wet");
    expect(out.prompt).toContain(spec.lighting["dusk-neon"]);
  });

  test("render config comes from the register, steps are klein's fixed 4", () => {
    expect(compile(spec, { register: "key-art", seed: 1 }).render).toMatchObject({ width: 1024, height: 1024 });
    expect(compile(spec, { register: "press-photo", seed: 1 }).render).toMatchObject({ width: 1024, height: 768 });
    expect(compile(spec, { register: "key-art", seed: 1 }).render.steps).toBe(4);
  });

  test("fails loudly on an unknown register, palette, or surface", () => {
    expect(() => compile(spec, { register: "oil-painting" })).toThrow(/unknown register/);
    expect(() => compile(spec, { register: "key-art", palette: "vaporwave" })).toThrow(/unknown palette/);
    expect(() => compileForSurface(spec, "backpage")).toThrow(/unknown surface/);
  });
});

describe("surfaces", () => {
  test("each surface resolves to a register and its brief reaches the prompt", () => {
    const loading = compileForSurface(spec, "loading", { seed: 2 });
    expect(loading.register).toBe("key-art");
    expect(loading.prompt).toContain("name plate clear");

    const frontpage = compileForSurface(spec, "frontpage", { seed: 2 });
    expect(frontpage.register).toBe("press-photo");
    expect(frontpage.prompt).toContain("above the fold");
  });
});

describe("compliance gate", () => {
  test("assertSafe rejects a poisoned prompt", () => {
    expect(() => assertSafe("a portrait set in Vice City", spec.compliance.prohibited)).toThrow(/prohibited term/);
    expect(() => assertSafe("a clean original portrait", spec.compliance.prohibited)).not.toThrow();
  });

  test("the spec itself declares the disclaimer the README must carry", () => {
    expect(spec.compliance.disclaimer).toMatch(/Not affiliated/);
  });
});

describe("provenance", () => {
  test("filenames record register, seed and spec version", () => {
    const name = plateFilename({ register: "key-art", seed: 12345, specVersion: spec.version });
    expect(name).toMatch(/^\d{14}-key-art-s12345-v1\.0\.0\.png$/);
  });
});

describe("pick", () => {
  test("names the known keys when it fails, so a typo is obvious", () => {
    expect(() => pick({ a: 1, b: 2 }, "c", "thing")).toThrow(/known: a, b/);
  });
});
