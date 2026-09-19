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
 *   --gguf                use the Q4_K_M GGUF build (needs the ComfyUI-GGUF node)
 *   --check               validate the graph against the server's node schemas, then exit
 */

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { compile, plateFilename } from "../../src/look/compile.mjs";

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
    if (key === "gguf" || key === "check") args[key] = true;
    else if (next && !next.startsWith("--")) args[key] = next;
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
  }

  if (args.check) {
    const problems = await checkGraph(server, graph);
    console.log(problems.length ? `graph problems:\n  ${problems.join("\n  ")}` : "graph OK against live node schemas");
    process.exit(problems.length ? 1 : 0);
  }

  if (!args.photo) {
    console.error("--photo is required (see the header of this file)");
    process.exit(2);
  }

  const compiled = compile(spec, {
    surface: args.surface ?? "loading",
    register: args.register,
    lighting: args.lighting,
    palette: args.palette,
    brief: args.brief,
    seed: args.seed ? Number(args.seed) : undefined,
  });

  const problems = await checkGraph(server, graph);
  if (problems.length) {
    console.error(`graph does not match this server:\n  ${problems.join("\n  ")}`);
    process.exit(1);
  }

  const started = Date.now();
  const uploaded = await uploadImage(server, resolve(args.photo));
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

  console.log(`wrote ${out}`);
  console.log(`  ${((Date.now() - started) / 1000).toFixed(1)}s wall clock · ${Math.round(bytes.length / 1024)} KB · spec v${compiled.specVersion} · lighting ${compiled.lighting} · palette ${compiled.palette}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
