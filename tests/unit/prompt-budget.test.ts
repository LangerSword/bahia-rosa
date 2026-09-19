import { describe, expect, test } from "vitest";
import spec from "../../src/look/look.json";
import { compile } from "../../src/look/compile.mjs";

/**
 * A 4B distilled model reads the front of the prompt and skims the rest. The spec promises a budget
 * (render.promptBudget) so the prompt stays in the range the model actually follows; this test is
 * what makes that promise true, instead of a comment nobody checks.
 */
describe("prompt budget", () => {
  const budget = spec.render.promptBudget as number;

  test.each(Object.keys(spec.surfaces))("surface %s compiles inside the budget", (surface) => {
    const compiled = compile(spec, { surface });
    expect(compiled.prompt.length).toBeLessThanOrEqual(budget);
  });

  test("the punch line leads every prompt", () => {
    for (const surface of Object.keys(spec.surfaces)) {
      const compiled = compile(spec, { surface });
      expect(compiled.prompt.startsWith(spec.punch)).toBe(true);
    }
  });

  test("identity is stated early — within the first third of the prompt", () => {
    const compiled = compile(spec, { surface: "debut" });
    const identityAt = compiled.prompt.indexOf(spec.identity.rules[0]);
    expect(identityAt).toBeGreaterThanOrEqual(0);
    expect(identityAt).toBeLessThan(compiled.prompt.length / 3);
  });

  test("palette anchors stay out of the prompt unless the spec asks for them", () => {
    const compiled = compile(spec, { surface: "debut" });
    for (const anchor of spec.palette["neon-wet"].anchors) {
      expect(compiled.prompt.includes(anchor)).toBe(false);
    }
  });
});
