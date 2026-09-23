#!/usr/bin/env node
/**
 * The city's locations.
 *
 * These are not gradients: they are painted scenes the subject is placed *into* — a beach with
 * loungers and a lifeguard tower, a neon mall promenade, a marina, a rooftop pool, a palm boulevard
 * at night. Generated once by the local model, committed, and then used as the ground of every frame
 * the press produces.
 *
 * Scenery only: no people, by instruction and then verified with a face detector before shipping.
 *
 *   node tools/print-desk/scenes.mjs                 # every scene
 *   node tools/print-desk/scenes.mjs --id beach      # one
 *   node tools/print-desk/scenes.mjs --seed 42       # a different take on all of them
 */
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const PROJECT = resolve(HERE, "../..");
const SERVER = process.env.COMFY_URL ?? "http://127.0.0.1:8188";
const OUT_DIR = resolve(PROJECT, "public/art/scenes");

/**
 * The look is the game's, not a photograph's: warm sun, deep violet shade, saturated sky, and a
 * composed frame with a clear foreground the subject can stand in. "no people" is not a style note —
 * a person rendered into the plate would be a second, wrong subject.
 */
const SCENES = {
  beach: {
    prompt:
      "wide cinematic shot of a Miami-style beach at golden hour, palm trees along the sand, a striped lifeguard tower, sun loungers and a parasol, turquoise water and gentle surf, art-deco hotels on the horizon, warm rim light, deep violet shadows, painted key art, high detail, no people, no text",
    negative: "people, person, crowd, faces, text, watermark, letters, deformed, blurry",
  },
  mall: {
    prompt:
      "wide cinematic shot of an open-air shopping promenade at dusk, neon storefronts glowing pink and cyan, string lights between palms, wet polished pavement with reflections, art-deco arcade, warm sunset sky above the roofline, painted key art, high detail, no people, no text",
    negative: "people, person, crowd, faces, text, watermark, letters, deformed, blurry",
  },
  marina: {
    prompt:
      "wide cinematic shot of a marina at golden hour, white yachts and sailboat masts on calm water, a wooden boardwalk with palm trees, pastel art-deco buildings behind, warm sun low over the water, deep violet shadows, painted key art, high detail, no people, no text",
    negative: "people, person, crowd, faces, text, watermark, letters, deformed, blurry",
  },
  rooftop: {
    prompt:
      "wide cinematic shot of a rooftop swimming pool at dusk, turquoise water glowing from within, sun loungers and a parasol, palm fronds in the foreground, a lit city skyline behind, warm sunset sky, painted key art, high detail, no people, no text",
    negative: "people, person, crowd, faces, text, watermark, letters, deformed, blurry",
  },
  boulevard: {
    prompt:
      "wide cinematic shot of a palm-lined boulevard at night, neon signs in pink and gold, wet asphalt with long reflections, art-deco towers, a low sports car parked at the kerb, warm street glow against a violet sky, painted key art, high detail, no people, no text",
    negative: "people, person, crowd, faces, text, watermark, letters, deformed, blurry",
  },
};

const SIZE = { width: 1344, height: 768 };

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i].startsWith("--")) args[argv[i].slice(2)] = argv[i + 1]?.startsWith("--") ? true : argv[++i];
  }
  return args;
}

async function loadGraph(prompt, negative, seed) {
  const graphPath = resolve(HERE, "workflow-sdxl.json");
  if (!existsSync(graphPath)) throw new Error(`no workflow at ${graphPath}`);
  const graph = JSON.parse(await readFile(graphPath, "utf8"));
  const nodes = Object.values(graph);

  const byClass = (name) => nodes.filter((node) => node?.class_type === name);
  const positive = byClass("CLIPTextEncode")[0];
  const negativeNode = byClass("CLIPTextEncode")[1];
  const latent = byClass("EmptyLatentImage")[0];
  const sampler = byClass("KSampler")[0];
  if (positive) positive.inputs.text = prompt;
  if (negativeNode) negativeNode.inputs.text = negative;
  if (latent) {
    latent.inputs.width = SIZE.width;
    latent.inputs.height = SIZE.height;
  }
  if (sampler) sampler.inputs.seed = seed;
  return graph;
}

async function run(prompt, negative, seed) {
  const graph = await loadGraph(prompt, negative, seed);
  const started = Date.now();
  const queued = await fetch(`${SERVER}/prompt`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ prompt: graph, client_id: "scenes" }),
  });
  if (!queued.ok) throw new Error(`the desk refused the prompt: ${queued.status} ${await queued.text()}`);
  const { prompt_id: promptId } = await queued.json();

  for (let attempt = 0; attempt < 240; attempt += 1) {
    await new Promise((r) => setTimeout(r, 2000));
    const history = await fetch(`${SERVER}/history/${promptId}`);
    const record = (await history.json())[promptId];
    if (!record?.outputs) continue;
    for (const output of Object.values(record.outputs)) {
      for (const image of output.images ?? []) {
        const view = await fetch(
          `${SERVER}/view?filename=${encodeURIComponent(image.filename)}&subfolder=${encodeURIComponent(image.subfolder ?? "")}&type=${image.type ?? "output"}`,
        );
        return { bytes: Buffer.from(await view.arrayBuffer()), filename: image.filename, seconds: (Date.now() - started) / 1000 };
      }
    }
  }
  throw new Error("the desk never finished this scene");
}

const args = parseArgs(process.argv.slice(2));
await mkdir(OUT_DIR, { recursive: true });

for (const [id, scene] of Object.entries(SCENES)) {
  if (args.id && args.id !== id) continue;
  const seed = Number(args.seed ?? 4200) + Object.keys(SCENES).indexOf(id) * 13;
  process.stdout.write(`${id.padEnd(10)} `);
  try {
    const { bytes, filename, seconds } = await run(scene.prompt, scene.negative, seed);
    const out = resolve(OUT_DIR, `${id}.png`);
    await writeFile(out, bytes);
    console.log(`${seconds.toFixed(0)}s  ${Math.round(bytes.length / 1024)} KB  seed ${seed}  ${filename}`);
  } catch (error) {
    console.log(`FAILED — ${error.message}`);
  }
}