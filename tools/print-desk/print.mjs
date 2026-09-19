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

  const compiled = args.prompt
    ? {
        ...compile(spec, { surface: args.surface ?? "loading", register: args.register, lighting: args.lighting, palette: args.palette, brief: args.brief, seed: args.seed ? Number(args.seed) : undefined }),
        prompt: args.prompt,
      }
    : compile(spec, {
    surface: args.surface ?? "loading",
    register: args.register,
    lighting: args.lighting,
    palette: args.palette,
    brief: args.brief,
    seed: args.seed ? Number(args.seed) : undefined,
  });

  // --hq: the quality preset. The plain 4-step distilled model is the fast path; the base model at
  // 26 steps holds detail and light far better, and it runs at guidance 1.0 — CFG above 1 both burns
  // the picture (saturation ~160 against the model's own ~78) and doubles the cost of every step.
  if (args.hq) {
    graph["1"].inputs.unet_name = "flux-2-klein-base-4b-fp8.safetensors";
    graph["12"].inputs.steps = 26;
    graph["15"].inputs.cfg = 1.0;
  }

  const problems = await checkGraph(server, graph);
  if (problems.length) {
    console.error(`graph does not match this server:\n  ${problems.join("\n  ")}`);
    process.exit(1);
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
  graph["11"].inputs.width = compiled.render.width;
  graph["11"].inputs.height = compiled.render.height;
  graph["12"].inputs.width = compiled.render.width;
  graph["12"].inputs.height = compiled.render.height;
  graph["12"].inputs.steps = compiled.render.steps;
  graph["14"].inputs.noise_seed = compiled.seed;
  graph["15"].inputs.cfg = compiled.render.guidance;
  graph["18"].inputs.filename_prefix = `fifteen-minutes/${compiled.register}`;
  if (!args["ref-megapixels"]) graph["5"].inputs.megapixels = Number(args["ref-megapixels"] ?? 0.26);
  if (args.steps) graph["12"].inputs.steps = Number(args.steps);
  if (args.guidance) graph["15"].inputs.cfg = Number(args.guidance);
  if (args.warmup) {
    graph["11"].inputs.width = graph["12"].inputs.width = 256;
    graph["11"].inputs.height = graph["12"].inputs.height = 256;
  }

  const queued = await jsonFetch(`${server}/prompt`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ prompt: graph, client_id: "print-desk" }),
  });

  process.stdout.write(`queued ${queued.prompt_id} · register ${compiled.register} · seed ${compiled.seed} · `);
  process.stdout.write(`${compiled.render.width}x${compiled.render.height} · ${compiled.prompt.length} prompt chars\n`);

  let file = null;
  for (let attempt = 0; attempt < 600; attempt++) {
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

  const out = resolve(
    args.out ?? resolve(HERE, "../../print-desk-out", plateFilename({ register: compiled.register, seed: compiled.seed, specVersion: compiled.specVersion })),
  );
  await mkdir(dirname(out), { recursive: true });
  await writeFile(out, bytes);

  // Face restore: the plate keeps its generated hair, body and city, but the face region is the
  // photo's own pixels, graded into the plate's light. A 4B model at 4 steps always drifts a face a
  // little; this is the one step that makes identity exact instead of approximate.
  let fixed = out;
  if (!args["no-facefix"] && reference !== out) {
    fixed = out.replace(/\.png$/, "") + "-face.png";
    try {
      const { stdout } = await runAsync(
        PYTHON,
        [resolve(HERE, "facefix.py"), out, reference, "--out", fixed, "--mode", args["facefix-mode"] ?? "mixed"],
        { maxBuffer: 4 * 1024 * 1024 },
      );
      const report = JSON.parse(stdout);
      if (report.skipped) {
        console.warn(`  face restore skipped: ${report.skipped}`);
        fixed = out;
      } else {
        await copyFile(out, out.replace(/\.png$/, "") + "-raw.png");
        console.log(`  face restored: colour gap ${report.colour_gap.before} → ${report.colour_gap.after} · mask ${report.mask_pixels}px`);
      }
    } catch (error) {
      console.warn(`  face restore failed: ${error instanceof Error ? error.message.split("\n")[0] : error}`);
      fixed = out;
    }
  }

  if (fixed !== out) await copyFile(fixed, out);

  console.log(`wrote ${out}`);
  console.log(`  ${((Date.now() - started) / 1000).toFixed(1)}s wall clock · ${Math.round(bytes.length / 1024)} KB · spec v${compiled.specVersion} · lighting ${compiled.lighting} · palette ${compiled.palette}`);
  if (args.warmup) console.log("warm: desk ready — weights, text encoder and VAE are resident");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
