/**
 * Hosted portrait renderer — the server (Cloudflare Worker) owns the model call.
 *
 * Flow: downscale the selfie to the model's input limit in the browser → POST base64 →
 * Worker calls FLUX.2 [klein] 4B with the photo as a reference image → base64 PNG back.
 *
 * Model facts (verified 2026-09-19): input images must be < 512x512; output 256-1920 per side;
 * ~83 neurons per 1024x768 portrait against a 10,000 neurons/day free allocation.
 */

export const MAX_INPUT_EDGE = 512;

export interface RenderResult {
  dataUrl: string;
  model: string;
}

export interface RenderError extends Error {
  status?: number;
  code?: string;
}

/** Pure: the size to resample to so the longest edge is within `maxEdge`. */
export function targetSize(width: number, height: number, maxEdge: number = MAX_INPUT_EDGE): { width: number; height: number } {
  const longest = Math.max(width, height);
  if (longest <= maxEdge) return { width: Math.max(1, Math.round(width)), height: Math.max(1, Math.round(height)) };
  const scale = maxEdge / longest;
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

/** Browser-only: resample a File to a base64 JPEG within the input limit. */
export async function fileToBase64Jpeg(file: File, maxEdge: number = MAX_INPUT_EDGE): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const { width, height } = targetSize(bitmap.width, bitmap.height, maxEdge);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("canvas 2d context unavailable");
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();
  const dataUrl = canvas.toDataURL("image/jpeg", 0.9);
  return dataUrl.slice(dataUrl.indexOf(",") + 1);
}

export interface RenderOptions {
  note?: string;
  fetcher?: typeof fetch;
  endpoint?: string;
}

/** POST the photo to the Worker and return a data URL ready for the editor. */
export async function renderHosted(dataUrl: string, options: RenderOptions = {}): Promise<RenderResult> {
  const fetcher = options.fetcher ?? fetch;
  const endpoint = options.endpoint ?? "/api/portrait";
  const imageBase64 = dataUrl.includes(",") ? dataUrl.slice(dataUrl.indexOf(",") + 1) : dataUrl;

  const response = await fetcher(endpoint, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ imageBase64, note: options.note }),
  });

  const payload = (await response.json().catch(() => null)) as
    | { image?: string; model?: string; error?: string; limit?: number }
    | null;

  if (!response.ok || !payload?.image) {
    const error = new Error(payload?.error ? `portrait_failed:${payload.error}` : `portrait_failed:http_${response.status}`) as RenderError;
    error.status = response.status;
    error.code = payload?.error;
    throw error;
  }

  return { dataUrl: `data:image/jpeg;base64,${payload.image}`, model: payload.model ?? "unknown" };
}
