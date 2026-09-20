#!/usr/bin/env node
/**
 * The print desk — generate one plate locally.
 *
 *   node tools/print-desk/print.mjs --photo ~/me.jpg --surface loading --out /tmp/plate.png
 *
 * It compiles the prompt from the look spec (src/look/look.json), uploads the reference photo to
 * the local ComfyUI, runs FLUX.2 [klein] 4B against it, and writes the result with its provenance.
 * Nothing leaves the machine; there is no API key anywhere in this path.
 *
 * Flags:
 *   --photo <path>        reference image (required)
 *   --surface <id>        loading | frontpage | poster            (default: loading)
 *   --register <key>      override the surface's register
 *   --lighting <key>      override the register's lighting preset
 *   --palette <key>       override the register's palette preset
 *   --brief "<text>"      override the surface brief
 *   --seed <int>          fixed seed (default: random, printed for reproducibility)
 *   --out <path>          output file (default: print-desk-out/<provenance>.png)
 *   --server <url>        ComfyUI base url (default: http://127.0.0.1:8188)
 *   --hq                  quality preset: base 4B at 26 steps, guidance 1.0 (~70s instead of ~15s)
 *   --unet <file>         use a specific checkpoint in models/diffusion_models
 *   --steps <n>           override the scheduler steps
 *   --guidance <n>        override cfg (klein-family models run at 1.0)
 *   --ref-megapixels <n>  reference scale; klein wants its input under 512px (default 0.26)
 *   --prompt "<text>"     bypass the look compiler entirely (for A/B experiments)
 *   --no-frame            skip face detection and crop the photo as-is
 *   --no-facefix          keep the raw plate, do not restore the face from the photo
 *   --warmup              load the weights with one tiny pass so the next print is fast
 *   --gguf                use the Q4_K_M GGUF build (needs the ComfyUI-GGUF node)
 *   --check               validate the graph against the server's node schemas, then exit
 */

import { copyFile, readFile, writeFile, mkdir } from "node:fs/promises";
import { basename, dirname, resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { compile, plateFilename } from "../../src/look/compile.mjs";

const runAsync = promisify(execFile);
const PYTHON = process.env.PRINT_DESK_PYTHON ?? "/home/lakshaya/.venv/bin/python";

/** The quality preset, in one place. Mirrors HQ_UNET/HQ_STEPS in the browser client. */
const HQ_UNET = "flux-2-klein-base-4b-fp8.safetensors";
const HQ_STEPS = 26;
const HQ_GUIDANCE = 1.0;
const HQ_SIZE = 1024;
const HQ_IDENTITY_FLOOR = 0.45;

/** ArcFace identity of a finished plate against the photo — the gate that decides a reprint. */
async function identityOf(plate, reference) {
  try {
    const { stdout } = await runAsync(PYTHON, [resolve(HERE, "identity.py"), plate, reference], { maxBuffer: 4 * 1024 * 1024, timeout: 300_000 });
    return JSON.parse(stdout);
  } catch {
    return null;
  }
}

/**
 * Frame the reference before printing. A face that fills 4% of a landscape photo prints as mush;
 * framed to head-and-shoulders it prints as a portrait. Returns the path to use plus the report.
 */
async function frameReference(photoPath) {
  const dir = resolve(HERE, "../../print-desk-out/framed");
  await mkdir(dir, { recursive: true });
  const out = join(dir, `${basename(photoPath).replace(/\W+/g, "-")}-framed.png`);
  try {
    const { stdout } = await runAsync(PYTHON, [resolve(HERE, "frame.py"), photoPath, "--out", out], { maxBuffer: 4 * 1024 * 1024 });
    return { path: out, report: JSON.parse(stdout) };
  } catch (error) {
    console.warn(`  framing skipped: ${error instanceof Error ? error.message.split("\n")[0] : error}`);
    return { path: photoPath, report: null };
  }
}

const HERE = dirname(fileURLToPath(import.meta.url));
const LOOK_PATH = resolve(HERE, "../../src/look/look.json");
const WORKFLOW_PATH = resolve(HERE, "workflow.json");

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (!token.startsWith("--")) continue;
    const key = token.slice(2);
    const next = argv[i + 1];
    // A flag with no value — or one followed by another flag — is a boolean. This is what made
    // --no-frame and --no-facefix silently do nothing when they were listed as booleans here.
    if (!next || next.startsWith("--")) args[key] = true;
    else args[key] = next;
  }
  return args;
}

async function jsonFetch(url, init) {
  const response = await fetch(url, init);
  if (!response.ok) throw new Error(`${init?.method ?? "GET"} ${url} -> ${response.status} ${await response.text()}`);
  return response.json();
}

async function uploadImage(server, photoPath) {
  const bytes = await readFile(photoPath);
  const form = new FormData();
  form.append("image", new Blob([bytes], { type: "image/png" }), basename(photoPath));
  form.append("type", "input");
  form.append("overwrite", "true");
  const body = await jsonFetch(`${server}/upload/image`, { method: "POST", body: form });
  return body.subfolder ? `${body.subfolder}/${body.name}` : body.name;
}

/** Validate every class_type + its required inputs against the live server, before submitting. */
async function checkGraph(server, graph) {
  const info = await jsonFetch(`${server}/object_info`);
  const problems = [];
  for (const [id, node] of Object.entries(graph)) {
    if (id.startsWith("_")) continue;
    const schema = info[node.class_type];
    if (!schema) {
      problems.push(`node ${id}: class_type "${node.class_type}" is not available on this server`);
      continue;
    }
    for (const field of Object.keys(schema.input?.required ?? {})) {
      if (!(field in node.inputs)) problems.push(`node ${id} (${node.class_type}): missing required input "${field}"`);
    }
    for (const field of Object.keys(node.inputs)) {
      const known = field in (schema.input?.required ?? {}) || field in (schema.input?.optional ?? {});
      if (!known) problems.push(`node ${id} (${node.class_type}): unknown input "${field}"`);
    }
  }
  return problems;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const server = args.server ?? "http://127.0.0.1:8188";
  const spec = JSON.parse(await readFile(LOOK_PATH, "utf8"));
  const graph = JSON.parse(await readFile(WORKFLOW_PATH, "utf8"));

  if (args.gguf) {
    graph["1"] = { class_type: "UnetLoaderGGUF", inputs: { unet_name: "flux-2-klein-4b-Q4_K_M.gguf" } };
  } else if (args.unet) {
    graph["1"].inputs.unet_name = args.unet;
  }

  if (args.check) {
    const problems = await checkGraph(server, graph);
    console.log(problems.length ? `graph problems:\n  ${problems.join("\n  ")}` : "graph OK against live node schemas");
    process.exit(problems.length ? 1 : 0);
  }

  if (!args.photo && !args.warmup) {
    console.error("--photo is required (see the header of this file)");
    process.exit(2);
  }
  if (args.warmup) {
    // Warm the desk: one tiny pass so the weights, text encoder and VAE are resident before the
    // first real print — on an 8 GB card that cold load is most of the wait.
    args.photo = args.photo ?? resolve(HERE, "../../public/art/demo/placeholder.png");
    args.out = args.out ?? "/tmp/print-desk-warmup.png";
    args["no-frame"] = true;
    args["no-facefix"] = true;
  }

  const seedForLocation = args.seed ? Number(args.seed) : Math.floor(Math.random() * 2 ** 31);
  // Rotate the backdrop unless one is named: one photo should not always print the same street.
  const locationKeys = Object.keys(spec.locations ?? {}).filter((key) => key !== "note");
  const location =
    args.location ?? (args["no-rotate-locations"] || locationKeys.length === 0 ? undefined : locationKeys[seedForLocation % locationKeys.length]);

  const compiled = args.prompt
    ? {
        ...compile(spec, {
          surface: args.surface ?? "loading",
          register: args.register,
          location,
          lighting: args.lighting,
          palette: args.palette,
          brief: args.brief,
          seed: seedForLocation,
        }),
        prompt: args.prompt,
      }
    : compile(spec, {
    surface: args.surface ?? "loading",
    register: args.register,
    location,
    lighting: args.lighting,
    palette: args.palette,
    brief: args.brief,
    seed: seedForLocation,
  });

  const problems = await checkGraph(server, graph);
  if (problems.length) {
    console.error(`graph does not match this server:\n  ${problems.join("\n  ")}`);
    process.exit(1);
  }

  // The quality preset: the base model, 26 steps, guidance 1.0, and a 1280 canvas. The canvas matters
  // for the face — the restored face is composited at the size the plate gives it, so a bigger plate
  // means more real pixels in the face, not just a bigger picture.
  if (args.hq) {
    graph["1"].inputs.unet_name = HQ_UNET;
    args.width = args.width ?? HQ_SIZE;
    args.height = args.height ?? HQ_SIZE;
  }

  const started = Date.now();
  let reference = resolve(args.photo);
  if (!args["no-frame"]) {
    const framed = await frameReference(reference);
    if (framed.report?.face) {
      const share = (framed.report.face_share_of_original * 100).toFixed(1);
      console.log(
        `  framed: ${framed.report.face.faces_found} face(s) found · ${framed.report.face.method} · face was ${share}% of the original · crop ${framed.report.crop?.join(",") ?? "n/a"}`,
      );
      reference = framed.path;
    }
  }
  const uploaded = await uploadImage(server, reference);
  graph["4"].inputs.image = uploaded;
  graph["6"].inputs.text = compiled.prompt;
  graph["11"].inputs.width = Number(args.width ?? compiled.render.width);
  graph["11"].inputs.height = Number(args.height ?? compiled.render.height);
  graph["12"].inputs.width = Number(args.width ?? compiled.render.width);
  graph["12"].inputs.height = Number(args.height ?? compiled.render.height);
  graph["12"].inputs.steps = args.hq ? HQ_STEPS : compiled.render.steps;
  graph["14"].inputs.noise_seed = compiled.seed;
  graph["15"].inputs.cfg = args.hq ? HQ_GUIDANCE : compiled.render.guidance;
  graph["18"].inputs.filename_prefix = `fifteen-minutes/${compiled.register}`;
  if (!args["ref-megapixels"]) graph["5"].inputs.megapixels = Number(args["ref-megapixels"] ?? 0.26);
  if (args.steps) graph["12"].inputs.steps = Number(args.steps);
  if (args.guidance) graph["15"].inputs.cfg = Number(args.guidance);
  if (args.warmup) {
    graph["11"].inputs.width = graph["12"].inputs.width = 256;
    graph["11"].inputs.height = graph["12"].inputs.height = 256;
  }

  const attempts = Math.max(1, Number(args.attempts ?? 1));
  const minIdentity = args["min-identity"] !== undefined ? Number(args["min-identity"]) : args.hq ? HQ_IDENTITY_FLOOR : null;

  const out = resolve(
    args.out ?? resolve(HERE, "../../print-desk-out/plates", plateFilename({ register: compiled.register, location: compiled.location, seed: compiled.seed, specVersion: compiled.specVersion })),
  );
  await mkdir(dirname(out), { recursive: true });

  // Print, restore, measure, and if the face is not the person in the photo, print again. "Quality
  // mode" means a plate that passes, not a plate that took longer.
  let best = null;
  for (let attempt = 0; attempt < attempts; attempt++) {
    const seed = compiled.seed + attempt * 7919;
    graph["14"].inputs.noise_seed = seed;

    const queued = await jsonFetch(`${server}/prompt`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ prompt: graph, client_id: "print-desk" }),
    });
    process.stdout.write(
      `attempt ${attempt + 1}/${attempts} · ${graph["11"].inputs.width}x${graph["11"].inputs.height} · steps ${graph["12"].inputs.steps} · cfg ${graph["15"].inputs.cfg} · seed ${seed} · `,
    );
    process.stdout.write(`location ${compiled.location ?? "spec default"} · ${compiled.prompt.length} prompt chars\n`);

    let file = null;
    for (let tick = 0; tick < 900; tick++) {
      await new Promise((r) => setTimeout(r, 1000));
      const history = await jsonFetch(`${server}/history/${queued.prompt_id}`);
      const entry = history[queued.prompt_id];
      if (!entry) continue;
      if (entry.status?.status_str === "error") {
        console.error("generation failed:", JSON.stringify(entry.status).slice(0, 800));
        process.exit(1);
      }
      const images = Object.values(entry.outputs ?? {}).flatMap((output) => output.images ?? []);
      if (images.length) {
        file = images[0];
        break;
      }
    }
    if (!file) {
      console.error("timed out waiting for the plate");
      process.exit(1);
    }

    const view = `${server}/view?filename=${encodeURIComponent(file.filename)}&subfolder=${encodeURIComponent(file.subfolder ?? "")}&type=${file.type ?? "output"}`;
    const bytes = new Uint8Array(await (await fetch(view)).arrayBuffer());

    const platePath = attempts > 1 ? out.replace(/\.png$/, `-try${attempt + 1}.png`) : out;
    await writeFile(platePath, bytes);

    // Face restore: the plate keeps its generated hair, body and city, but the face region is the
    // photo's own pixels, aligned by landmarks and graded into the plate's light.
    let faceReport = null;
    if (!args["no-facefix"]) {
      const fixed = platePath.replace(/\.png$/, "") + "-face.png";
      try {
        const { stdout } = await runAsync(
          PYTHON,
          [
            resolve(HERE, "facefix.py"),
            platePath,
            reference,
            // The face is cut from the original photo at full resolution, not the framed copy.
            ...(reference !== resolve(args.photo) ? ["--source", resolve(args.photo)] : []),
            "--out",
            fixed,
            "--mode",
            args["facefix-mode"] ?? "alpha",
            "--reframe-size",
            String(graph["11"].inputs.width),
          ],
          { maxBuffer: 4 * 1024 * 1024, timeout: 300_000 },
        );
        faceReport = JSON.parse(stdout);
        if (faceReport.skipped) {
          console.warn(`  face restore skipped: ${faceReport.skipped}`);
        } else {
          await copyFile(platePath, platePath.replace(/\.png$/, "") + "-raw.png");
          await copyFile(fixed, platePath);
        }
      } catch (error) {
        console.warn(`  face restore failed: ${error instanceof Error ? error.message.split("\n")[0] : error}`);
      }
    }

    const identity = minIdentity !== null ? await identityOf(platePath, reference) : null;
    // A refused restore is a failed take, not a pass: the plate still has the model's own face on it.
    const refused = faceReport?.geometry_rejected ?? faceReport?.skipped ?? null;
    const score = refused ? 0 : identity?.similarity ?? 1;
    if (faceReport && !faceReport.skipped) {
      const alignment = faceReport.alignment?.mode === "eyes" ? `eyes (${faceReport.alignment.angle_deg}°, ×${faceReport.alignment.scale})` : "box";
      process.stdout.write(`  face ${alignment} · colour gap ${faceReport.colour_gap?.before} → ${faceReport.colour_gap?.after}`);
    }
    if (identity) process.stdout.write(` · identity ${identity.similarity} (${identity.verdict})`);
    process.stdout.write("\n");

    if (!best || score > best.score) best = { score, identity, file: platePath, bytes: bytes.length, seed, attempt };
    if (identity === null || score >= minIdentity) break;
    console.log(`  below the identity floor (${minIdentity}) — printing another take`);
  }

  if (best.file !== out) await copyFile(best.file, out);

  console.log(`wrote ${out}`);
  console.log(
    `  ${((Date.now() - started) / 1000).toFixed(1)}s wall clock · ${Math.round(best.bytes / 1024)} KB · spec v${compiled.specVersion} · lighting ${compiled.lighting} · palette ${compiled.palette}${best.identity ? ` · identity ${best.identity.similarity}` : ""}`,
  );
  if (args.warmup) console.log("warm: desk ready — weights, text encoder and VAE are resident");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
