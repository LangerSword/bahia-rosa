/**
 * The print desk, from the browser.
 *
 * The live app talks straight to a ComfyUI running on this machine (`/print-desk` is proxied to
 * 127.0.0.1:8188 by the dev server, and to whatever VITE_PRINT_DESK_URL points at in a deploy).
 * If no desk answers, the caller falls back to the baked cast plates — the experience never dies,
 * it just loses the "your own face" step.
 *
 * Progress is real, not a timer: ComfyUI streams execution events over its WebSocket, so the bar
 * tracks actual sampler steps (klein is a fixed 4-step model) and the decode that follows.
 */

import workflow from "../../../tools/print-desk/workflow.json";
import look from "../../look/look.json";
import { compile } from "../../look/compile.mjs";

export type PrintStage = "preparing" | "uploading" | "queued" | "sampling" | "developing" | "done" | "failed";

export interface PrintProgress {
  stage: PrintStage;
  /** 0–1, monotonic. */
  percent: number;
  message: string;
  step?: number;
  steps?: number;
}

export interface PrintResult {
  dataUrl: string;
  seed: number;
  register: string;
  seconds: number;
}

export interface PrintOptions {
  file: File;
  surface?: string;
  register?: string;
  seed?: number;
  baseUrl?: string;
  onProgress?: (progress: PrintProgress) => void;
  signal?: AbortSignal;
}

export class PrintDeskOffline extends Error {
  constructor() {
    super("no print desk is answering — the desk runs locally (see docs/print-desk.md)");
    this.name = "PrintDeskOffline";
  }
}

const DEFAULT_BASE = (() => {
  const env = (import.meta as unknown as { env?: Record<string, string> }).env;
  return env?.VITE_PRINT_DESK_URL ?? "/print-desk";
})();

/** Message shapes we care about from ComfyUI's /ws stream. */
export interface ComfyEvent {
  type: string;
  data?: { value?: number; max?: number; node?: string | number; prompt_id?: string; exception_message?: string };
}

/**
 * Turn one ComfyUI event into a progress update. Pure, so it is unit-tested without a server.
 * klein is a fixed 4-step sampler, so each step is 25% of the generating time.
 */
export function progressFromEvent(event: ComfyEvent, steps = look.render.steps): PrintProgress | null {
  switch (event.type) {
    case "status":
      return { stage: "queued", percent: 0.08, message: "queued at the desk" };
    case "execution_start":
      return { stage: "preparing", percent: 0.12, message: "loading the model" };
    case "executing":
      return { stage: "sampling", percent: 0.2, message: "printing", step: 0, steps };
    case "progress": {
      const value = Math.max(0, Math.min(event.data?.max ?? steps, event.data?.value ?? 0));
      const share = steps > 0 ? value / steps : 0;
      return {
        stage: "sampling",
        percent: 0.2 + share * 0.65,
        message: "printing",
        step: value,
        steps: event.data?.max ?? steps,
      };
    }
    case "executed":
      return { stage: "developing", percent: 0.9, message: "developing the plate" };
    case "execution_success":
      return { stage: "done", percent: 1, message: "plate ready" };
    case "execution_error":
      return { stage: "failed", percent: 1, message: event.data?.exception_message ?? "the desk jammed" };
    default:
      return null;
  }
}

/** Blob → data URL without FileReader, so the same code runs in the page and in Node tests. */
export async function blobToDataUrl(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return `data:${blob.type || "image/png"};base64,${btoa(binary)}`;
}

async function jsonFetch(url: string, init?: RequestInit): Promise<unknown> {
  const response = await fetch(url, init);
  if (!response.ok) throw new Error(`${init?.method ?? "GET"} ${url} -> ${response.status} ${await response.text()}`);
  return response.json();
}

/** Is a desk reachable at all? Cheap probe, used before showing the printing UI. */
export async function deskAvailable(baseUrl: string = DEFAULT_BASE): Promise<boolean> {
  try {
    const response = await fetch(`${baseUrl}/system_stats`, { signal: AbortSignal.timeout(2500) });
    return response.ok;
  } catch {
    return false;
  }
}

async function uploadPhoto(baseUrl: string, file: File): Promise<string> {
  const form = new FormData();
  form.append("image", file, file.name || "subject.png");
  form.append("type", "input");
  form.append("overwrite", "true");
  const body = (await jsonFetch(`${baseUrl}/upload/image`, { method: "POST", body: form })) as {
    name: string;
    subfolder?: string;
  };
  return body.subfolder ? `${body.subfolder}/${body.name}` : body.name;
}

export async function printPlate(options: PrintOptions): Promise<PrintResult> {
  const baseUrl = options.baseUrl ?? DEFAULT_BASE;
  const started = Date.now();
  const report = (progress: PrintProgress) => options.onProgress?.(progress);

  report({ stage: "preparing", percent: 0.02, message: "warming the desk" });
  if (!(await deskAvailable(baseUrl))) throw new PrintDeskOffline();

  const compiled = compile(look, {
    surface: options.surface ?? "debut",
    register: options.register,
    seed: options.seed,
  }) as { prompt: string; register: string; seed: number; render: { width: number; height: number; steps: number; guidance: number } };

  const clientId = `fifteen-${Math.random().toString(36).slice(2, 10)}`;
  const socketUrl = `${baseUrl.replace(/^http/, "ws")}/ws?clientId=${clientId}`;
  let socket: WebSocket | null = null;
  try {
    socket = new WebSocket(socketUrl);
  } catch {
    socket = null;
  }

  const finished = new Promise<void>((resolve, reject) => {
    if (!socket) return resolve();
    socket.onmessage = (message) => {
      try {
        const event = JSON.parse(String(message.data)) as ComfyEvent;
        const progress = progressFromEvent(event, compiled.render.steps);
        if (progress) {
          report(progress);
          if (progress.stage === "failed") reject(new Error(progress.message));
        }
      } catch {
        /* non-JSON frames are not ours */
      }
    };
    socket.onerror = () => resolve(); // fall back to polling
    socket.onclose = () => resolve();
  });

  report({ stage: "uploading", percent: 0.06, message: "handing your photo to the desk" });
  const uploaded = await uploadPhoto(baseUrl, options.file);

  const graph = structuredClone(workflow) as Record<string, { class_type: string; inputs: Record<string, unknown> }>;
  graph["4"].inputs.image = uploaded;
  graph["6"].inputs.text = compiled.prompt;
  graph["11"].inputs.width = compiled.render.width;
  graph["11"].inputs.height = compiled.render.height;
  graph["12"].inputs.width = compiled.render.width;
  graph["12"].inputs.height = compiled.render.height;
  graph["12"].inputs.steps = compiled.render.steps;
  graph["14"].inputs.noise_seed = compiled.seed;
  graph["15"].inputs.cfg = compiled.render.guidance;

  const queued = (await jsonFetch(`${baseUrl}/prompt`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ prompt: graph, client_id: clientId }),
  })) as { prompt_id: string };

  report({ stage: "queued", percent: 0.1, message: "queued at the desk" });

  // Poll /history as the source of truth; the socket only makes the bar smooth.
  let image: { filename: string; subfolder?: string; type?: string } | null = null;
  const deadline = Date.now() + 5 * 60 * 1000;
  let ticks = 0;
  while (!image && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 900));
    ticks += 1;
    const history = (await jsonFetch(`${baseUrl}/history/${queued.prompt_id}`)) as Record<
      string,
      { outputs?: Record<string, { images?: { filename: string; subfolder?: string; type?: string }[] }>; status?: { status_str?: string } }
    >;
    const entry = history[queued.prompt_id];
    if (!entry) continue;
    if (entry.status?.status_str === "error") throw new Error("the desk jammed — check the ComfyUI console");
    const images = Object.values(entry.outputs ?? {}).flatMap((output) => output.images ?? []);
    if (images.length) image = images[0];
    else if (!socket) {
      // No socket: keep the bar honest by advancing the sampling share slowly.
      const share = Math.min(0.65, ticks * 0.05);
      report({ stage: "sampling", percent: 0.2 + share, message: "printing" });
    }
  }
  if (!image) throw new Error("the desk took too long — try again");

  report({ stage: "developing", percent: 0.9, message: "developing the plate" });
  const view = `${baseUrl}/view?filename=${encodeURIComponent(image.filename)}&subfolder=${encodeURIComponent(image.subfolder ?? "")}&type=${image.type ?? "output"}`;
  const blob = await (await fetch(view)).blob();
  const dataUrl = await blobToDataUrl(blob);

  socket?.close();
  await finished.catch(() => undefined);
  report({ stage: "done", percent: 1, message: "plate ready" });

  return {
    dataUrl,
    seed: compiled.seed,
    register: compiled.register,
    seconds: (Date.now() - started) / 1000,
  };
}
