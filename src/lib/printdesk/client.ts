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
  location: string | null;
  seconds: number;
  /** ArcFace identity of the finished plate against the photograph, when the desk measured it. */
  identity: { similarity: number; verdict: string } | null;
}

export interface PrintOptions {
  file: File;
  surface?: string;
  register?: string;
  /** Where the subject stands; omit to let the desk rotate through the city. */
  location?: string;
  /** The quality preset: base model, 26 steps, guidance 1.0 (~70s cold, ~10s warm). */
  quality?: boolean;
  seed?: number;
  baseUrl?: string;
  onProgress?: (progress: PrintProgress) => void;
  signal?: AbortSignal;
}

/** The choices the intake UI offers, straight from the look spec so the two can never drift apart. */
export function printChoices() {
  const surfaces = Object.entries((look as { surfaces: Record<string, { register: string }> }).surfaces).map(
    ([id, value]) => ({ id, register: value.register, label: (look as { registers: Record<string, { label?: string }> }).registers[value.register]?.label ?? id }),
  );
  const locations = Object.entries((look as { locations: Record<string, { label?: string; note?: string }> }).locations)
    .filter(([key]) => key !== "note")
    .map(([id, value]) => ({ id, label: value.label ?? id }));
  return { surfaces, locations };
}

/** The quality preset, in one place so the graph and the progress bar can never disagree. */
export const HQ_UNET = "flux-2-klein-base-4b-fp8.safetensors";
export const HQ_STEPS = 26;
// The quality canvas. klein is a 1K model: pushing the canvas to 1280 made the subject come out
// small and off-centre, and the restore then had almost no face to work with. Quality comes from
// steps, the geometry gate and a reprint — not from a bigger frame.
export const HQ_SIZE = 1024;
// A finished plate below this ArcFace similarity is not the person in the photo, so it is reprinted
// instead of shipped. Measured on this pipeline: raw model output 0.083, restored plates 0.93–0.95.
export const HQ_IDENTITY_FLOOR = 0.45;
export const HQ_ATTEMPTS = 2;

export class PrintDeskOffline extends Error {
  constructor() {
    super("no print desk is answering — the desk runs locally (see docs/print-desk.md)");
    this.name = "PrintDeskOffline";
  }
}

/** Message shapes we care about from ComfyUI's /ws stream. */
export interface ComfyEvent {
  type: string;
  data?: { value?: number; max?: number; node?: string | number; prompt_id?: string; exception_message?: string };
}

/**
 * Turn one ComfyUI event into a progress update. Pure, so it is unit-tested without a server.
 *
 * The denominator is the event's own `max`, never the spec's step count: the quality preset runs 26
 * steps against a spec that says 4, and dividing by the spec made the bar reach 440%.
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
      const total = Math.max(1, event.data?.max ?? steps);
      const value = Math.max(0, Math.min(total, event.data?.value ?? 0));
      const share = Math.min(1, value / total);
      return {
        stage: "sampling",
        percent: Math.min(0.85, 0.2 + share * 0.65),
        message: "printing",
        step: value,
        steps: total,
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
  if (response.status === 403) {
    throw new Error(
      "the desk refused the upload (403). ComfyUI only accepts requests whose origin matches its own — " +
        "in development the app's proxy sets that header, so restart the dev server if you just changed its config.",
    );
  }
  if (!response.ok) throw new Error(`${init?.method ?? "GET"} ${url} -> ${response.status} ${await response.text()}`);
  return response.json();
}

/**
 * Is a desk reachable at all? Used before showing the printing UI, and before every print.
 *
 * The window is generous on purpose: a desk behind a tunnel answers its first request slowly (cold
 * TLS through an edge, a GPU box busy with another job), and a 2.5 s probe declared a perfectly good
 * desk absent — the page then said "no desk on this host" while the desk was up. One retry, and only
 * a 5xx or a transport error counts as "not there": a 404 is a real answer from something else.
 */
export async function deskAvailable(baseUrl: string = deskBaseUrl()): Promise<boolean> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const response = await fetch(`${baseUrl}/system_stats`, { signal: AbortSignal.timeout(8000) });
      if (response.ok) return true;
      if (response.status < 500) return false;
    } catch {
      // Transport error or timeout: try once more before giving up on it.
    }
  }
  return false;
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

/**
 * Where the desk is.
 *
 * The desk does not run on the host that serves the app: on a static deploy it is somewhere else
 * entirely (a tunnel, a rented GPU), and a tunnel URL changes every time it restarts. So the root is
 * resolved at runtime, in this order:
 *
 *   1. `?desk=https://…` in the address — persisted, so it survives a reload and can be shared
 *   2. whatever that left in localStorage
 *   3. `VITE_PRINT_DESK_URL`, baked in at build time
 *   4. this origin (the dev proxy)
 *
 * The value is a *root*, not a path: the desk's front door serves `/print-desk/*` and
 * `/restore-desk/*` side by side, so the app adds the prefix itself. A value that already carries
 * `/print-desk` is accepted and normalised, because that is what a person would paste.
 *
 * Nothing here is a secret: the front door is what decides who may print, and how often.
 */
const STORAGE_KEY = "late-edition.desk";
const ENV_ROOT = ((import.meta as unknown as { env?: Record<string, string> }).env?.VITE_PRINT_DESK_URL ?? "")
  .trim()
  .replace(/\/+$/, "")
  .replace(/\/print-desk$/, "");

let cachedRoot: string | null = null;

/** The desk's origin, or "" when it is this origin. */
export function deskRoot(): string {
  if (cachedRoot !== null) return cachedRoot;
  try {
    const asked = new URLSearchParams(window.location.search).get("desk");
    if (asked !== null) {
      const clean = asked.trim().replace(/\/+$/, "").replace(/\/print-desk$/, "");
      if (clean) window.localStorage.setItem(STORAGE_KEY, clean);
      else window.localStorage.removeItem(STORAGE_KEY);
      cachedRoot = clean;
      return cachedRoot;
    }
    const stored = window.localStorage.getItem(STORAGE_KEY)?.replace(/\/+$/, "").replace(/\/print-desk$/, "");
    if (stored) {
      cachedRoot = stored;
      return cachedRoot;
    }
  } catch {
    // No window, or storage denied: fall through to the build-time value.
  }
  cachedRoot = ENV_ROOT;
  return cachedRoot;
}

/** The ComfyUI-shaped API, wherever the desk is. */
export function deskBaseUrl(): string {
  const root = deskRoot();
  return root ? `${root}/print-desk` : "/print-desk";
}

/** The finishing service lives behind the same door. */
function finishBase(): string {
  const root = deskRoot();
  return root ? `${root}/restore-desk` : "/restore-desk";
}

async function finish<T>(route: string, payload: unknown): Promise<T | null> {
  try {
    const response = await fetch(`${finishBase()}${route}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(300_000),
    });
    if (!response.ok) return null;
    return (await response.json()) as T;
  } catch {
    // The service is optional: without it the app still prints, just without the face restore.
    return null;
  }
}

/** A data URL back into a File, so the framed photo can go through the same upload path. */
export function dataUrlToFile(dataUrl: string, name = "subject.png"): File {
  const match = /^data:([^;]+);base64,(.+)$/.exec(dataUrl);
  if (!match) throw new Error("not a base64 data URL");
  const binary = atob(match[2]);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return new File([bytes], name, { type: match[1] });
}

export async function printPlate(options: PrintOptions): Promise<PrintResult> {
  const baseUrl = options.baseUrl ?? deskBaseUrl();
  const started = Date.now();
  const report = (progress: PrintProgress) => options.onProgress?.(progress);

  report({ stage: "preparing", percent: 0.02, message: "warming the desk" });
  if (!(await deskAvailable(baseUrl))) throw new PrintDeskOffline();

  const compiled = compile(look, {
    surface: options.surface ?? "debut",
    register: options.register,
    location: options.location,
    seed: options.seed,
  }) as {
    prompt: string;
    register: string;
    location: string | null;
    seed: number;
    render: { width: number; height: number; steps: number; guidance: number };
  };

  // Declared before the socket opens: the progress handler reads it the moment the first event lands.
  const effectiveSteps = options.quality ? HQ_STEPS : compiled.render.steps;

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
        const progress = progressFromEvent(event, effectiveSteps);
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

  report({ stage: "uploading", percent: 0.06, message: "framing your face" });
  // Frame first: the model restyles what it can see, and a face that fills 4% of a landscape photo
  // prints as mush. Without the service this is a no-op and the original goes straight through.
  const originalDataUrl = await blobToDataUrl(options.file);
  const prepared = await finish<{ framed: string; report: { skipped?: string } }>("/prepare", { photo: originalDataUrl });
  const framedDataUrl = prepared?.framed ?? originalDataUrl;
  const uploaded = await uploadPhoto(baseUrl, prepared ? dataUrlToFile(framedDataUrl) : options.file);

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

  // The quality preset mirrors `print.mjs --hq`: base 4B at 26 steps, guidance 1.0, and a 1280
  // canvas. CFG above 1 on this family both burns the colours and doubles the cost of every step,
  // so it is not used. The canvas is not cosmetic — the face is composited back at the size the
  // plate gives it, so 1280 keeps more of the photograph's real pixels in the face than 1024 can.
  if (options.quality) {
    graph["1"].inputs.unet_name = HQ_UNET;
    graph["12"].inputs.steps = HQ_STEPS;
    graph["15"].inputs.cfg = 1.0;
    graph["11"].inputs.width = graph["12"].inputs.width = HQ_SIZE;
    graph["11"].inputs.height = graph["12"].inputs.height = HQ_SIZE;
  }

  // Quality mode means a plate that passes, not a plate that took longer. The desk measures the
  // finished face; if it is not the person in the photograph, print another take rather than hand
  // back something the user will squint at. Fast prints take one roll, as before.
  const floor = options.quality ? HQ_IDENTITY_FLOOR : null;
  const maxAttempts = options.quality ? HQ_ATTEMPTS : 1;
  let plate = "";
  let identity: { similarity: number; verdict: string } | null = null;
  let printedSeed = compiled.seed;

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    printedSeed = compiled.seed + attempt * 7919;
    graph["14"].inputs.noise_seed = printedSeed;

    const queued = (await jsonFetch(`${baseUrl}/prompt`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ prompt: graph, client_id: clientId }),
    })) as { prompt_id: string };

    report({ stage: "queued", percent: 0.1, message: attempt === 0 ? "queued at the desk" : `take ${attempt + 1} queued` });

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

    report({ stage: "developing", percent: 0.9, message: "putting your face back" });
    const view = `${baseUrl}/view?filename=${encodeURIComponent(image.filename)}&subfolder=${encodeURIComponent(image.subfolder ?? "")}&type=${image.type ?? "output"}`;
    const blob = await (await fetch(view)).blob();
    const rawDataUrl = await blobToDataUrl(blob);

    // The face restore: the plate keeps the city, the hair and the light, but the face region becomes
    // the photograph's own pixels, aligned by landmarks and graded into the plate. This is the step
    // that turns "a character who looks a bit like you" into you.
    const restored = await finish<{
      plate: string;
      identity: { similarity: number; verdict: string } | null;
      report?: { skipped?: string; geometry_rejected?: string };
    }>("/restore", {
      plate: rawDataUrl,
      reference: framedDataUrl,
      source: originalDataUrl,
    });

    plate = restored?.plate ?? rawDataUrl;
    identity = restored?.identity ?? null;
    // A refused restore is not a pass: the plate would still carry the model's own face. Reprint.
    const refused = restored?.report?.geometry_rejected ?? restored?.report?.skipped ?? null;
    if (!refused && (floor === null || !identity || identity.similarity >= floor)) break;
    if (attempt + 1 < maxAttempts) {
      report({
        stage: "sampling",
        percent: 0.35,
        message: refused
          ? `the desk would not paste that one (${refused}) — printing another take`
          : `the face came out at ${identity?.similarity.toFixed(2)} — printing another take`,
      });
    }
  }

  socket?.close();
  await finished.catch(() => undefined);
  report({ stage: "done", percent: 1, message: "plate ready" });

  return {
    dataUrl: plate,
    seed: printedSeed,
    register: compiled.register,
    location: compiled.location ?? null,
    seconds: (Date.now() - started) / 1000,
    identity,
  };
}
