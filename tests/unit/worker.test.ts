import { describe, expect, test, vi } from "vitest";
import { handlePortrait, GLOBAL_DAILY_LIMIT, MODEL, PER_IP_DAILY_LIMIT, stylePrompt, type Env } from "../../worker/index";

/**
 * The Worker is the only server-side surface, so its contract gets tested like a public API:
 * happy path, cache header, budget exhaustion, malformed input, model failure.
 */

const PHOTO = Buffer.from("not-really-a-jpeg").toString("base64");

function makeEnv(result: unknown = { image: "aGVsbG8=" }) {
  const run = vi.fn(async (_model: string, _inputs: unknown) => result);
  const env: Env = {
    AI: { run },
    ASSETS: { fetch: async () => new Response("asset") },
  };
  return { env, run };
}

function post(body: unknown, ip = "203.0.113.7"): Request {
  return new Request("https://fifteen-minutes.example/api/portrait", {
    method: "POST",
    headers: { "content-type": "application/json", "cf-connecting-ip": ip },
    body: JSON.stringify(body),
  });
}

describe("stylePrompt", () => {
  test("keeps the recognisability and no-text rules", () => {
    const prompt = stylePrompt();
    expect(prompt).toContain("recognisable");
    expect(prompt).toContain("No text");
  });

  test("appends a surface note", () => {
    expect(stylePrompt("make it night-time")).toContain("make it night-time");
  });
});

describe("POST /api/portrait", () => {
  test("returns the generated image and calls the pinned model", async () => {
    const { env, run } = makeEnv();
    const response = await handlePortrait(post({ imageBase64: PHOTO }), env);
    const payload = (await response.json()) as { image: string; model: string };

    expect(response.status).toBe(200);
    expect(payload.image).toBe("aGVsbG8=");
    expect(payload.model).toBe(MODEL);
    expect(run).toHaveBeenCalledTimes(1);
    expect(run.mock.calls[0][0]).toBe(MODEL);
    expect(response.headers.get("x-fifteen-cache")).toBe("miss");
  });

  test("rejects a body without an image", async () => {
    const { env } = makeEnv();
    const response = await handlePortrait(post({}), env);
    expect(response.status).toBe(400);
    expect((await response.json()) as object).toMatchObject({ error: "missing_image" });
  });

  test("rejects invalid JSON", async () => {
    const { env } = makeEnv();
    const request = new Request("https://example.test/api/portrait", {
      method: "POST",
      headers: { "cf-connecting-ip": "203.0.113.9" },
      body: "{not json",
    });
    const response = await handlePortrait(request, env);
    expect(response.status).toBe(400);
  });

  test("surfaces a model failure as 502 rather than a silent empty image", async () => {
    const { env } = makeEnv();
    env.AI.run = async () => {
      throw new Error("upstream exploded");
    };
    const response = await handlePortrait(post({ imageBase64: PHOTO }, "203.0.113.11"), env);
    expect(response.status).toBe(502);
    expect((await response.json()) as object).toMatchObject({ error: "model_failed" });
  });

  test("treats an empty model result as 502", async () => {
    const { env } = makeEnv({ text: "I refuse" });
    const response = await handlePortrait(post({ imageBase64: PHOTO }, "203.0.113.12"), env);
    expect(response.status).toBe(502);
  });

  test("enforces the per-IP daily budget", async () => {
    const { env } = makeEnv();
    const ip = "198.51.100.42";
    const photo = (n: number) => Buffer.from(`photo-${n}`).toString("base64");
    for (let i = 0; i < PER_IP_DAILY_LIMIT; i++) {
      const ok = await handlePortrait(post({ imageBase64: photo(i) }, ip), env);
      expect(ok.status).toBe(200);
    }
    const blocked = await handlePortrait(post({ imageBase64: photo(999) }, ip), env);
    expect(blocked.status).toBe(429);
    expect((await blocked.json()) as object).toMatchObject({ error: "rate_limited", scope: "ip" });
  });

  test("global budget is finite", () => {
    expect(GLOBAL_DAILY_LIMIT).toBeGreaterThan(0);
    expect(GLOBAL_DAILY_LIMIT).toBeLessThanOrEqual(250);
  });
});
