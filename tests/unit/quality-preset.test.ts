import { describe, expect, test } from "vitest";
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

  test("quality means a bigger canvas than the fast path", () => {
    // The face is composited back at the size the plate gives it, so this is a face-detail setting.
    expect(HQ_SIZE).toBeGreaterThan(1024);
    expect(HQ_STEPS).toBeGreaterThan(4);
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
