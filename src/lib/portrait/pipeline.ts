/**
 * The portrait seam. Renderers are registered by id; the app asks for the one it wants and
 * never knows how the pixels were produced. Swapping providers is a one-line change here.
 *
 * Default is `hosted` (Cloudflare Worker → FLUX.2 [klein] 4B): generation happens off the
 * client, no key in the browser. The in-browser toon pipeline (`toon.ts`, unit-tested) stays
 * available as an offline fallback but is not registered by default — see docs/portrait.md.
 */

import { renderHosted, type RenderResult } from "./hosted";

export type RendererId = "hosted";

export interface PortraitRequest {
  /** data URL or base64 of the source photo, already within the model's input limit. */
  image: string;
  note?: string;
}

export type PortraitRenderer = (request: PortraitRequest) => Promise<RenderResult>;

const renderers: Record<RendererId, PortraitRenderer> = {
  hosted: ({ image, note }) => renderHosted(image, { note }),
};

export function renderPortrait(request: PortraitRequest, id: RendererId = "hosted"): Promise<RenderResult> {
  const renderer = renderers[id];
  if (!renderer) throw new Error(`unknown portrait renderer: ${id}`);
  return renderer(request);
}

/** A friendly message for the UI. Rate limits are a first-class outcome, not an error path. */
export function describeRenderFailure(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes("rate_limited")) return "The city's print desk is at capacity for today — try again tomorrow, or use a demo character.";
  if (message.includes("model_failed")) return "The print desk jammed. Try again in a moment.";
  if (message.includes("bad_image_size")) return "That photo is too large — try a smaller one.";
  return "Something went wrong building your portrait. Try another photo.";
}
