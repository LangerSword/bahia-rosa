var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// worker/index.ts
var MODEL = "@cf/black-forest-labs/flux-2-klein-4b";
var MAX_INPUT_EDGE = 512;
var OUTPUT_WIDTH = 1024;
var OUTPUT_HEIGHT = 768;
var PER_IP_DAILY_LIMIT = 4;
var GLOBAL_DAILY_LIMIT = 250;
function stylePrompt(extra) {
  const base = "Take the person in the reference image and turn them into a stylised video-game character portrait for a loading-screen card: bold black ink outlines, flat graphic colour areas, simplified features, confident shapes. Keep the person clearly recognisable \u2014 same face shape, same hairstyle, same glasses if they wear them. Head and shoulders, centred, on a completely flat solid deep-maroon background with a few thin white line-art city landmarks (suspension bridge, tram, palm trees, arches) drawn behind them at low opacity. No text, no logos, no watermarks, no frame.";
  return extra ? `${base} ${extra}` : base;
}
__name(stylePrompt, "stylePrompt");
var dayKey = /* @__PURE__ */ __name(() => (/* @__PURE__ */ new Date()).toISOString().slice(0, 10), "dayKey");
var counters = /* @__PURE__ */ new Map();
function bump(key, limit) {
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
__name(bump, "bump");
async function sha256Hex(bytes) {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
__name(sha256Hex, "sha256Hex");
function base64ToBytes(b64) {
  const clean = b64.includes(",") ? b64.slice(b64.indexOf(",") + 1) : b64;
  const binary = atob(clean);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}
__name(base64ToBytes, "base64ToBytes");
async function readCache(key) {
  const g = globalThis;
  if (!g.caches?.default) return null;
  return await g.caches.default.match(new Request(`https://cache.internal/${key}`)) ?? null;
}
__name(readCache, "readCache");
async function writeCache(key, response) {
  const g = globalThis;
  if (!g.caches?.default) return;
  await g.caches.default.put(new Request(`https://cache.internal/${key}`), response.clone());
}
__name(writeCache, "writeCache");
function json(body, status = 200, extra = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...extra }
  });
}
__name(json, "json");
async function handlePortrait(request, env) {
  if (request.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "invalid_json" }, 400);
  }
  if (!body?.imageBase64 || typeof body.imageBase64 !== "string") {
    return json({ error: "missing_image" }, 400);
  }
  let bytes;
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
  form.append("input_image_0", new Blob([bytes], { type: "image/jpeg" }), "subject.jpg");
  form.append("width", String(OUTPUT_WIDTH));
  form.append("height", String(OUTPUT_HEIGHT));
  const formResponse = new Response(form);
  let result;
  try {
    result = await env.AI.run(MODEL, {
      multipart: {
        body: formResponse.body,
        contentType: formResponse.headers.get("content-type")
      }
    });
  } catch (error) {
    return json({ error: "model_failed", message: error instanceof Error ? error.message : String(error) }, 502);
  }
  const image = result?.image;
  if (!image) return json({ error: "model_empty", raw: JSON.stringify(result).slice(0, 400) }, 502);
  const response = json({ image, model: MODEL, width: OUTPUT_WIDTH, height: OUTPUT_HEIGHT });
  await writeCache(cacheKey, response);
  return new Response(response.body, { headers: { ...response.headers, "x-fifteen-cache": "miss" } });
}
__name(handlePortrait, "handlePortrait");
var index_default = {
  async fetch(request, env, _ctx) {
    const url = new URL(request.url);
    if (url.pathname === "/api/health") {
      return json({
        ok: true,
        model: MODEL,
        limits: { perIpDaily: PER_IP_DAILY_LIMIT, globalDaily: GLOBAL_DAILY_LIMIT },
        maxInputEdge: MAX_INPUT_EDGE
      });
    }
    if (url.pathname === "/api/portrait") return handlePortrait(request, env);
    return env.ASSETS.fetch(request);
  }
};
export {
  GLOBAL_DAILY_LIMIT,
  MAX_INPUT_EDGE,
  MODEL,
  OUTPUT_HEIGHT,
  OUTPUT_WIDTH,
  PER_IP_DAILY_LIMIT,
  index_default as default,
  handlePortrait,
  stylePrompt
};
//# sourceMappingURL=index.js.map
