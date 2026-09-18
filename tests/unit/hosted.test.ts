import { describe, expect, test, vi } from "vitest";
import { renderHosted, targetSize } from "../../src/lib/portrait/hosted";
import { describeRenderFailure, renderPortrait } from "../../src/lib/portrait/pipeline";

describe("targetSize", () => {
  test("leaves small images alone", () => {
    expect(targetSize(300, 400, 512)).toEqual({ width: 300, height: 400 });
  });

  test("scales the longest edge down to the limit and keeps the aspect ratio", () => {
    expect(targetSize(1200, 800, 512)).toEqual({ width: 512, height: 341 });
    expect(targetSize(800, 1600, 512)).toEqual({ width: 256, height: 512 });
  });

  test("never returns a zero dimension", () => {
    expect(targetSize(1000, 1, 512)).toEqual({ width: 512, height: 1 });
  });
});

describe("renderHosted", () => {
  test("posts base64 and returns a data URL", async () => {
    const fetcher = vi.fn(async () =>
      new Response(JSON.stringify({ image: "QUJD", model: "@cf/black-forest-labs/flux-2-klein-4b" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );

    const result = await renderHosted("data:image/jpeg;base64,QUJD", { fetcher: fetcher as unknown as typeof fetch });
    expect(result.dataUrl).toBe("data:image/jpeg;base64,QUJD");

    const [url, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/portrait");
    expect(JSON.parse(String(init.body))).toMatchObject({ imageBase64: "QUJD" });
  });

  test("maps a rate-limit response to a typed error", async () => {
    const fetcher = vi.fn(async () =>
      new Response(JSON.stringify({ error: "rate_limited" }), { status: 429, headers: { "content-type": "application/json" } }),
    );

    await expect(
      renderHosted("QUJD", { fetcher: fetcher as unknown as typeof fetch }),
    ).rejects.toMatchObject({ status: 429, code: "rate_limited" });
  });
});

describe("pipeline", () => {
  test("default renderer is the hosted one (no client-side generation)", async () => {
    const fetcher = vi.fn(async () =>
      new Response(JSON.stringify({ image: "QUJD", model: "m" }), { status: 200, headers: { "content-type": "application/json" } }),
    );
    // hosted renderer uses global fetch; stub it for this test
    vi.stubGlobal("fetch", fetcher);
    const result = await renderPortrait({ image: "QUJD" });
    expect(result.dataUrl).toBe("data:image/jpeg;base64,QUJD");
    vi.unstubAllGlobals();
  });

  test("failures read like the product, not like a stack trace", () => {
    expect(describeRenderFailure(new Error("portrait_failed:rate_limited"))).toMatch(/capacity/i);
    expect(describeRenderFailure(new Error("portrait_failed:model_failed"))).toMatch(/jam/i);
    expect(describeRenderFailure(new Error("something else"))).toMatch(/try another photo/i);
  });
});
