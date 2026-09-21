#!/usr/bin/env node
/**
 * The city's own plates — scenery, no people.
 *
 * The chrome needs atmosphere and the placements need a ground to sit in, and neither may contain a
 * real person or a cast stand-in. So the city itself is generated: the same location specs the print
 * desk uses (`src/look/look.json`), rendered by SDXL text-to-image with the subject clauses stripped
 * out. No keys, no stock photography, nothing borrowed.
 *
 *   node tools/print-desk/scenery.mjs --all --outdir public/art/city
 *   node tools/print-desk/scenery.mjs --location marina --out public/art/city/marina.jpg
 */

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const LOOK_PATH = resolve(HERE, "../../src/look/look.json");
const WORKFLOW_PATH = resolve(HERE, "workflow-sdxl.json");

/** Wide, empty, and lit like the site: an establishing shot with room for type over it. */
const NEGATIVE =
  "person, people, crowd, face, portrait, figure, silhouette of a person, hands, illustration, painting, cartoon, anime, cgi, 3d render, watermark, signature, text, letters, logo, frame, border, blurry, low contrast, oversaturated";

const args = {};
for (let i = 0; i < process.argv.length; i += 1) {
  const token = process.argv[i];
  if (!token.startsWith("--")) continue;
  const key = token.slice(2);
  const next = process.argv[i + 1];
  if (key === "all") args.all = true;
  else if (next && !next.startsWith("--")) args[key] = next;
}

const server = args.server ?? "http://127.0.0.1:8188";

async function jsonFetch(url, init) {
  const response = await fetch(url, init);
  if (!response.ok) throw new Error(`${init?.method ?? "GET"} ${url} -> ${response.status} ${await response.text()}`);
  return response.json();
}

/** The scenery clause, its lighting and its palette — everything except the person. */
function promptFor(look, location) {
  const palette = look.palette?.[location.palette] ?? {};
  const lighting = look.lighting?.[location.lighting] ?? "";
  return [
    location.scenery,
    location.time ? `${location.time}.` : "",
    lighting,
    palette.description ?? "",
    "Empty city at the blue hour: no people anywhere, no signage text, no lettering.",
    "Wide cinematic establishing shot, deep depth of field, film grain, shot on 85mm, no subject.",
  ]
    .filter(Boolean)
    .join(" ")
    .replaceAll(/\s+/g, " ")
    .trim();
}

async function generate(graph, prompt, seed, width, height) {
  const g = structuredClone(graph);
  g["2"].inputs.text = prompt;
  g["3"].inputs.text = NEGATIVE;
  g["4"].inputs.width = width;
  g["4"].inputs.height = height;
  g["5"].inputs.seed = seed;
  const queued = await jsonFetch(`${server}/prompt`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ prompt: g, client_id: "print-desk-scenery" }),
  });
  for (let tick = 0; tick < 900; tick += 1) {
    await new Promise((r) => setTimeout(r, 1000));
    const history = await jsonFetch(`${server}/history/${queued.prompt_id}`);
    const entry = history[queued.prompt_id];
    if (!entry) continue;
    if (entry.status?.status_str === "error") throw new Error(`generation failed: ${JSON.stringify(entry.status).slice(0, 500)}`);
    const images = Object.values(entry.outputs ?? {}).flatMap((output) => output.images ?? []);
    if (images.length) return images[0];
  }
  throw new Error("timed out waiting for the scenery");
}

async function main() {
  const look = JSON.parse(await readFile(LOOK_PATH, "utf8"));
  const graph = JSON.parse(await readFile(WORKFLOW_PATH, "utf8"));
  const width = Number(args.width ?? 1344);
  const height = Number(args.height ?? 768);

  const locations = Object.entries(look.locations ?? {}).filter(([id, location]) => id !== "note" && location.scenery);
  const wanted = args.all ? locations : locations.filter(([id]) => id === args.location);
  if (!wanted.length) {
    console.error(`no location matched (known: ${locations.map(([id]) => id).join(", ")})`);
    process.exit(2);
  }

  await mkdir(resolve(args.outdir ?? "public/art/city"), { recursive: true });
  for (const [id, location] of wanted) {
    const started = Date.now();
    const seed = Number(location.seed ?? 7100 + locations.findIndex(([name]) => name === id) * 13);
    const prompt = promptFor(look, location);
    const image = await generate(graph, prompt, seed, width, height);
    const view = `${server}/view?filename=${encodeURIComponent(image.filename)}&subfolder=${encodeURIComponent(image.subfolder ?? "")}&type=${image.type ?? "output"}`;
    const bytes = new Uint8Array(await (await fetch(view)).arrayBuffer());
    const out = resolve(args.out ?? resolve(args.outdir ?? "public/art/city", `${id}.png`));
    await mkdir(dirname(out), { recursive: true });
    await writeFile(out, bytes);
    console.log(`${id.padEnd(12)} ${((Date.now() - started) / 1000).toFixed(1)}s  ${Math.round(bytes.length / 1024)} KB  seed ${seed}  ${width}x${height}  -> ${out}`);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
