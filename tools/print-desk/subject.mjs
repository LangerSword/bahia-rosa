#!/usr/bin/env node
/**
 * The print desk's casting desk — generate a fictional demo subject locally.
 *
 *   node tools/print-desk/subject.mjs --id s1-marisol --out /tmp/subjects/s1.png
 *   node tools/print-desk/subject.mjs --all --outdir /tmp/subjects
 *
 * Why this exists: the plates ship in the repo, so the people in them must be invented. This runs
 * SDXL text-to-image (the checkpoint already on disk) to produce a plain, straight-on "photo" that
 * matches the app's own intake brief — then print.mjs restyles that photo into a plate. Two local
 * models, no keys, no real people in the build.
 */

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const SUBJECTS_PATH = resolve(HERE, "subjects.json");
const WORKFLOW_PATH = resolve(HERE, "workflow-sdxl.json");

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (!token.startsWith("--")) continue;
    const key = token.slice(2);
    const next = argv[i + 1];
    if (key === "all" || key === "check") args[key] = true;
    else if (next && !next.startsWith("--")) args[key] = next;
  }
  return args;
}

async function jsonFetch(url, init) {
  const response = await fetch(url, init);
  if (!response.ok) throw new Error(`${init?.method ?? "GET"} ${url} -> ${response.status} ${await response.text()}`);
  return response.json();
}

async function checkGraph(server, graph) {
  const info = await jsonFetch(`${server}/object_info`);
  const problems = [];
  for (const [id, node] of Object.entries(graph)) {
    const schema = info[node.class_type];
    if (!schema) {
      problems.push(`node ${id}: class_type "${node.class_type}" is not available`);
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

async function generate(server, graph, subject) {
  graph["2"].inputs.text = subject.prompt;
  graph["5"].inputs.seed = subject.seed;
  const queued = await jsonFetch(`${server}/prompt`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ prompt: graph, client_id: "print-desk-casting" }),
  });
  for (let attempt = 0; attempt < 900; attempt++) {
    await new Promise((r) => setTimeout(r, 1000));
    const history = await jsonFetch(`${server}/history/${queued.prompt_id}`);
    const entry = history[queued.prompt_id];
    if (!entry) continue;
    if (entry.status?.status_str === "error") throw new Error(`generation failed: ${JSON.stringify(entry.status).slice(0, 600)}`);
    const images = Object.values(entry.outputs ?? {}).flatMap((output) => output.images ?? []);
    if (images.length) return images[0];
  }
  throw new Error("timed out waiting for the subject");
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const server = args.server ?? "http://127.0.0.1:8188";
  const subjects = JSON.parse(await readFile(SUBJECTS_PATH, "utf8"));
  const graph = JSON.parse(await readFile(WORKFLOW_PATH, "utf8"));

  if (args.check) {
    const problems = await checkGraph(server, graph);
    console.log(problems.length ? `graph problems:\n  ${problems.join("\n  ")}` : "SDXL graph OK against live node schemas");
    process.exit(problems.length ? 1 : 0);
  }

  const problems = await checkGraph(server, graph);
  if (problems.length) {
    console.error(`graph does not match this server:\n  ${problems.join("\n  ")}`);
    process.exit(1);
  }

  const wanted = args.all ? subjects : subjects.filter((s) => s.id === args.id);
  if (!wanted.length) {
    console.error(`no subject matched (known ids: ${subjects.map((s) => s.id).join(", ")})`);
    process.exit(2);
  }

  for (const subject of wanted) {
    const started = Date.now();
    const image = await generate(server, graph, subject);
    const view = `${server}/view?filename=${encodeURIComponent(image.filename)}&subfolder=${encodeURIComponent(image.subfolder ?? "")}&type=${image.type ?? "output"}`;
    const bytes = new Uint8Array(await (await fetch(view)).arrayBuffer());
    const out = resolve(args.out ?? resolve(args.outdir ?? ".", `${subject.id}.png`));
    await mkdir(dirname(out), { recursive: true });
    await writeFile(out, bytes);
    console.log(`${subject.id.padEnd(14)} ${((Date.now() - started) / 1000).toFixed(1)}s  ${Math.round(bytes.length / 1024)} KB  seed ${subject.seed}  -> ${out}`);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
