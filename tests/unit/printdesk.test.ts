import { describe, expect, test } from "vitest";
import { readFile } from "node:fs/promises";
import { deskAvailable, printPlate, progressFromEvent } from "../../src/lib/printdesk/client";

/**
 * The printing UI is only as honest as its progress source, so the event mapping is tested
 * directly. The live case (a real desk printing a real plate) runs only when ComfyUI is up —
 * it is skipped elsewhere, including CI, where there is no GPU.
 */

const DESK = "http://127.0.0.1:8188";
const deskUp = await deskAvailable(DESK).catch(() => false);

describe("progressFromEvent", () => {
  test("status and start move the bar off zero", () => {
    expect(progressFromEvent({ type: "status" })?.stage).toBe("queued");
    const start = progressFromEvent({ type: "execution_start" });
    expect(start?.stage).toBe("preparing");
    expect(start!.percent).toBeGreaterThan(0);
  });

  test("each sampler step advances the bar, and four steps cover the sampling share", () => {
    const first = progressFromEvent({ type: "progress", data: { value: 1, max: 4 } })!;
    const third = progressFromEvent({ type: "progress", data: { value: 3, max: 4 } })!;
    expect(first.percent).toBeGreaterThan(0.2);
    expect(third.percent).toBeGreaterThan(first.percent);
    const last = progressFromEvent({ type: "progress", data: { value: 4, max: 4 } })!;
    expect(last.percent).toBeCloseTo(0.85, 2);
    expect(last.step).toBe(4);
  });

  test("decoding and completion land at the top of the bar", () => {
    expect(progressFromEvent({ type: "executed" })?.stage).toBe("developing");
    expect(progressFromEvent({ type: "execution_success" })?.percent).toBe(1);
  });

  test("an execution error is surfaced, not swallowed", () => {
    const failed = progressFromEvent({ type: "execution_error", data: { exception_message: "CUDA out of memory" } })!;
    expect(failed.stage).toBe("failed");
    expect(failed.message).toBe("CUDA out of memory");
  });

  test("unrelated events are ignored", () => {
    expect(progressFromEvent({ type: "crystools.monitor" })).toBeNull();
  });
});

describe("printPlate against a live desk", () => {
  test.skipIf(!deskUp)("prints a plate from a real photo and reports progress", async () => {
    const bytes = await readFile("public/art/demo/placeholder.png");
    const file = new File([bytes], "subject.png", { type: "image/png" });

    const seen: string[] = [];
    const result = await printPlate({
      file,
      baseUrl: DESK,
      surface: "debut",
      seed: 777,
      onProgress: (progress) => seen.push(progress.stage),
    });

    expect(result.dataUrl.startsWith("data:image/")).toBe(true);
    expect(result.register).toBe("character-shot");
    expect(result.seed).toBe(777);
    expect(seen).toContain("sampling");
    expect(seen.at(-1)).toBe("done");
  }, 240_000);
});
