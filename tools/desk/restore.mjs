#!/usr/bin/env node
/**
 * The desk's finishing service — the two steps the browser cannot do itself.
 *
 * The app can hand a photo to ComfyUI and get a plate back, but the two things that make the plate
 * good are Python: framing the face before the model sees it, and putting the photo's own face back
 * afterwards. Without this service the app shipped raw model output (ArcFace identity 0.08 — a
 * different person) while the CLI shipped 0.93. Same pipeline, two very different products.
 *
 *   POST /prepare  {photo}    → {framed, report}      face detect + head-and-shoulders crop
 *   POST /restore  {plate, reference, source}
 *                             → {plate, identity, report}   align, grade, blend, measure
 *   GET  /health              → {ok: true}
 *
 * Everything stays on this machine: it writes temp files, shells out to the same Python tools the CLI
 * uses, and returns data URLs. No network, no keys, no upload.
 */

import { createServer } from "node:http";
import { execFile } from "node:child_process";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const run = promisify(execFile);
const HERE = dirname(fileURLToPath(import.meta.url));
const PROJECT = resolve(HERE, "../..");
const PYTHON = process.env.PRINT_DESK_PYTHON ?? "/home/lakshaya/.venv/bin/python";
const PORT = Number(process.env.RESTORE_PORT ?? 8788);
const TMP = join(PROJECT, "print-desk-out", "restore-tmp");
const MAX_BODY = 40 * 1024 * 1024;

const readBody = (request) =>
  new Promise((resolveBody, rejectBody) => {
    let size = 0;
    const chunks = [];
    request.on("data", (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY) {
        rejectBody(new Error("body too large"));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on("end", () => resolveBody(Buffer.concat(chunks)));
    request.on("error", rejectBody);
  });

function decodeDataUrl(value, what) {
  const match = /^data:(image\/[a-z+]+);base64,(.+)$/i.exec(value ?? "");
  if (!match) throw new Error(`${what} must be a base64 image data URL`);
  return Buffer.from(match[2], "base64");
}

const send = (response, status, payload) => {
  const body = JSON.stringify(payload);
  response.writeHead(status, { "content-type": "application/json", "content-length": Buffer.byteLength(body) });
  response.end(body);
};

async function toDataUrl(path) {
  const bytes = await readFile(path);
  return `data:image/png;base64,${bytes.toString("base64")}`;
}

/** Frame the photo: the model restyles what it can see, and a 4%-of-frame face is not visible. */
async function prepare(photoDataUrl) {
  await mkdir(TMP, { recursive: true });
  const stamp = Date.now();
  const input = join(TMP, `photo-${stamp}.png`);
  const framed = join(TMP, `framed-${stamp}.png`);
  await writeFile(input, decodeDataUrl(photoDataUrl, "photo"));

  try {
    const { stdout } = await run(PYTHON, [resolve(HERE, "../print-desk/frame.py"), input, "--out", framed], { maxBuffer: 8 * 1024 * 1024 });
    const report = JSON.parse(stdout);
    return { framed: await toDataUrl(framed), report };
  } catch (error) {
    // No face, or no detector: hand back the original so the print still happens.
    const message = error instanceof Error ? error.message.split("\n")[0] : String(error);
    return { framed: photoDataUrl, report: { skipped: message } };
  } finally {
    await rm(input, { force: true });
    await rm(framed, { force: true });
  }
}

/** Restore the face: the plate keeps the city, the face is the photo's own pixels, then measured. */
async function restore({ plate, reference, source }) {
  await mkdir(TMP, { recursive: true });
  const stamp = Date.now();
  const paths = {
    plate: join(TMP, `plate-${stamp}.png`),
    reference: join(TMP, `reference-${stamp}.png`),
    source: join(TMP, `source-${stamp}.png`),
    fixed: join(TMP, `fixed-${stamp}.png`),
  };
  await writeFile(paths.plate, decodeDataUrl(plate, "plate"));
  await writeFile(paths.reference, decodeDataUrl(reference, "reference"));
  if (source) await writeFile(paths.source, decodeDataUrl(source, "source"));

  try {
    const args = [
      resolve(HERE, "../print-desk/facefix.py"),
      paths.plate,
      paths.reference,
      ...(source ? ["--source", paths.source] : []),
      "--out",
      paths.fixed,
      "--mode",
      "alpha",
    ];
    const { stdout } = await run(PYTHON, args, { maxBuffer: 8 * 1024 * 1024, timeout: 300_000 });
    const report = JSON.parse(stdout);
    if (report.skipped) return { plate, report, identity: null };

    let identity = null;
    try {
      const measured = await run(PYTHON, [resolve(HERE, "../print-desk/identity.py"), paths.fixed, paths.reference], {
        maxBuffer: 8 * 1024 * 1024,
        timeout: 300_000,
      });
      identity = JSON.parse(measured.stdout);
    } catch {
      identity = null;
    }
    return { plate: await toDataUrl(paths.fixed), report, identity };
  } finally {
    await Promise.all(Object.values(paths).map((path) => rm(path, { force: true })));
  }
}

const server = createServer(async (request, response) => {
  const url = new URL(request.url ?? "/", "http://localhost");
  const started = Date.now();
  response.on("finish", () => {
    if (url.pathname !== "/health") console.log(`${request.method} ${url.pathname} → ${response.statusCode} (${Date.now() - started}ms)`);
  });
  try {
    if (request.method === "GET" && url.pathname === "/health") return send(response, 200, { ok: true });

    if (request.method !== "POST") return send(response, 405, { error: "POST only" });
    const body = JSON.parse((await readBody(request)).toString("utf8"));

    if (url.pathname === "/prepare") return send(response, 200, await prepare(body.photo));
    if (url.pathname === "/restore") return send(response, 200, await restore(body));
    return send(response, 404, { error: "unknown route" });
  } catch (error) {
    send(response, 500, { error: error instanceof Error ? error.message : String(error) });
  }
});

server.listen(PORT, "127.0.0.1", () => console.log(`restore service on http://127.0.0.1:${PORT}`));
