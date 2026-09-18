/**
 * FIFTEEN MINUTES — Cloudflare Worker (static assets + one AI route).
 *
 * Portrait generation is server-side by design: the browser never holds a key.
 * Model: @cf/black-forest-labs/flux-2-klein-4b — FLUX.2 [klein] 4B, 4-step distilled,
 * supports reference images via multipart `input_image_0..3` (binary, each < 512x512),
 * so a selfie goes in and a stylised, recognisable character portrait comes out.
 * Cost: ~5.37 neurons per input tile + ~26.05 per output 512x512 tile
 *        (~83 neurons for 1024x768) → ~120 portraits/day inside the 10,000 free neurons/day.
 * Verified against Cloudflare's docs and the model changelog, 2026-09-19.
 *
 * Everything else (the editor, grading, kit export) is client-side.
 */

export interface Env {
  AI: AiBinding;
  ASSETS: { fetch: (request: Request) => Promise<Response> };
}

/** Minimal shape of the Workers AI binding — avoids pulling @cloudflare/workers-types in. */
export interface AiBinding {
  run: (model: string, inputs: unknown, options?: unknown) => Promise<unknown>;
}

export const MODEL = "@cf/black-forest-labs/flux-2-klein-4b";
export const MAX_INPUT_EDGE = 512; // model constraint: input images must be < 512x512
export const OUTPUT_WIDTH = 1024;
export const OUTPUT_HEIGHT = 768;

/** Daily budgets. Free tier is 10,000 neurons/day; ~83 neurons per portrait. */
export const PER_IP_DAILY_LIMIT = 4;
export const GLOBAL_DAILY_LIMIT = 250;

/** The one prompt the whole art direction hangs on. */
export function stylePrompt(extra?: string): string {
  const base =
    "Take the person in the reference image and turn them into a stylised video-game " +
    "character portrait for a loading-screen card: bold black ink outlines, flat graphic " +
    "colour areas, simplified features, confident shapes. Keep the person clearly " +
    "recognisable — same face shape, same hairstyle, same glasses if they wear them. " +
    "Head and shoulders, centred, on a completely flat solid deep-maroon background " +
    "with a few thin white line-art city landmarks (suspension bridge, tram, palm trees, " +
    "arches) drawn behind them at low opacity. No text, no logos, no watermarks, no frame.";
  return extra ? `${base} ${extra}` : base;
}

interface PortraitRequest {
  imageBase64: string;
  note?: string;
}

const dayKey = () => new Date().toISOString().slice(0, 10);

// Per-isolate counters: good enough for a hackathon submission, and they fail closed
// (a cold isolate resets them, which can only make the app *more* generous).
const counters = new Map<string, { day: string; n: number }>();

function bump(key: string, limit: number): boolean {
  const day = dayKey();
  const entry = counters.get(key);
  if (!entry || entry.day !== day) {
    counters.set(key, { day, n: 1 });
    return true;
  }
  if (entry.n >= limit) return false;
  entry.n += 1;
  return true;
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes as unknown as ArrayBuffer);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function base64ToBytes(b64: string): Uint8Array {
  const clean = b64.includes(",") ? b64.slice(b64.indexOf(",") + 1) : b64;
  const binary = atob(clean);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

/** Cache API is only present in the Workers runtime — guarded so the handler unit-tests in node. */
async function readCache(key: string): Promise<Response | null> {
  const g = globalThis as unknown as { caches?: { default?: Cache } };
  if (!g.caches?.default) return null;
  return (await g.caches.default.match(new Request(`https://cache.internal/${key}`))) ?? null;
}

async function writeCache(key: string, response: Response): Promise<void> {
  const g = globalThis as unknown as { caches?: { default?: Cache } };
  if (!g.caches?.default) return;
  await g.caches.default.put(new Request(`https://cache.internal/${key}`), response.clone());
}

function json(body: unknown, status = 200, extra: HeadersInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...extra },
  });
}

export async function handlePortrait(request: Request, env: Env): Promise<Response> {
  if (request.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  let body: PortraitRequest;
  try {
    body = (await request.json()) as PortraitRequest;
  } catch {
    return json({ error: "invalid_json" }, 400);
  }
  if (!body?.imageBase64 || typeof body.imageBase64 !== "string") {
    return json({ error: "missing_image" }, 400);
  }

  let bytes: Uint8Array;
  try {
    bytes = base64ToBytes(body.imageBase64);
  } catch {
    return json({ error: "invalid_base64" }, 400);
  }
  if (bytes.byteLength === 0 || bytes.byteLength > 4 * 1024 * 1024) {
    return json({ error: "bad_image_size", bytes: bytes.byteLength }, 413);
  }

  const ip = request.headers.get("cf-connecting-ip") ?? "anonymous";
  const cacheKey = `portrait/${await sha256Hex(bytes)}/${body.note ? encodeURIComponent(body.note) : "default"}`;

  const cached = await readCache(cacheKey);
  if (cached) return new Response(cached.body, { headers: { ...cached.headers, "x-fifteen-cache": "hit" } });

  if (!bump(`ip:${ip}`, PER_IP_DAILY_LIMIT)) return json({ error: "rate_limited", scope: "ip", limit: PER_IP_DAILY_LIMIT }, 429);
  if (!bump("global", GLOBAL_DAILY_LIMIT)) return json({ error: "rate_limited", scope: "global", limit: GLOBAL_DAILY_LIMIT }, 429);

  const form = new FormData();
  form.append("prompt", stylePrompt(body.note));
  form.append("input_image_0", new Blob([bytes as unknown as BlobPart], { type: "image/jpeg" }), "subject.jpg");
  form.append("width", String(OUTPUT_WIDTH));
  form.append("height", String(OUTPUT_HEIGHT));

  // FormData doesn't expose its serialized body or boundary; round-tripping through a
  // Request serializes it and sets the multipart Content-Type the model needs.
  const formResponse = new Response(form);

  let result: unknown;
  try {
    result = await env.AI.run(MODEL, {
      multipart: {
        body: formResponse.body,
        contentType: formResponse.headers.get("content-type"),
      },
    });
  } catch (error) {
    return json({ error: "model_failed", message: error instanceof Error ? error.message : String(error) }, 502);
  }

  const image = (result as { image?: string } | null)?.image;
  if (!image) return json({ error: "model_empty", raw: JSON.stringify(result).slice(0, 400) }, 502);

  const response = json({ image, model: MODEL, width: OUTPUT_WIDTH, height: OUTPUT_HEIGHT });
  await writeCache(cacheKey, response);
  return new Response(response.body, { headers: { ...response.headers, "x-fifteen-cache": "miss" } });
}

export default {
  async fetch(request: Request, env: Env, _ctx: unknown): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/api/health") {
      return json({
        ok: true,
        model: MODEL,
        limits: { perIpDaily: PER_IP_DAILY_LIMIT, globalDaily: GLOBAL_DAILY_LIMIT },
        maxInputEdge: MAX_INPUT_EDGE,
      });
    }

    if (url.pathname === "/api/portrait") return handlePortrait(request, env);

    return env.ASSETS.fetch(request);
  },
};
