import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { HQ_SIZE, HQ_STEPS, HQ_UNET } from "../../src/lib/printdesk/client";

/**
 * Quality mode exists twice — once in the browser client, once in the CLI — and the two drifting
 * apart is not hypothetical: the CLI shipped a "quality" preset that quietly ran the fast model at
 * four steps, and nothing caught it because no test compared them. This is that test. The constants
 * are read out of the real files, so changing one without the other fails here instead of on stage.
 */

const cli = await readFile("tools/print-desk/print.mjs", "utf8");
const client = await readFile("src/lib/printdesk/client.ts", "utf8");

const value = (source: string, name: string) => {
  const match = new RegExp(`(?:const|export const)\\s+${name}\\s*=\\s*([^;\\n]+)`).exec(source);
  return match?.[1].trim();
};

describe("the quality preset", () => {
  test("the CLI and the browser agree on the model, the steps and the canvas", () => {
    expect(value(cli, "HQ_UNET")).toBe(JSON.stringify(HQ_UNET));
    expect(Number(value(cli, "HQ_STEPS"))).toBe(HQ_STEPS);
    expect(Number(value(cli, "HQ_SIZE"))).toBe(HQ_SIZE);
    expect(value(client, "HQ_SIZE")).toBe(String(HQ_SIZE));
  });

  test("quality means more steps, a reprint — not a bigger canvas", () => {
    // 1280 was tried and reverted: klein is a 1K model, and the bigger frame made the subject come out
    // small and off-centre, which left the restore almost no face to work with. Quality is the step
    // count, the geometry gate and the reprint. The lessons are in the comment above the constant.
    expect(HQ_SIZE).toBe(1024);
    expect(HQ_STEPS).toBeGreaterThan(4);
  });

  test("the restore refuses a paste it cannot place, instead of pasting it anyway", () => {
    const facefix = readFileSync("tools/print-desk/facefix.py", "utf8");
    expect(facefix).toContain("geometry_rejected");
    expect(facefix).toMatch(/def plausible\(/);
    // And the refusal has to count as a failed take in both callers, or it silently ships a stranger.
    expect(cli).toMatch(/const refused = faceReport\?\.geometry_rejected/);
    expect(client).toMatch(/const refused = restored\?\.report\?\.geometry_rejected/);
  });

  test("the CLI refuses to ship a plate whose face is not the photo's face", () => {
    expect(cli).toContain("HQ_IDENTITY_FLOOR");
    expect(cli).toMatch(/score >= minIdentity/);
    expect(cli).toMatch(/printing another take/);
  });

  test("the app refuses the same way, instead of showing a stranger", () => {
    expect(client).toContain("HQ_IDENTITY_FLOOR");
    expect(client).toMatch(/identity\.similarity >= floor/);
    expect(value(client, "HQ_ATTEMPTS")).toBe("2");
  });
});
