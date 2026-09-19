#!/usr/bin/env node
/**
 * The quality harness — print, judge, keep the best, and say why.
 *
 *   node tools/print-desk/harness.mjs --photo ~/me.jpg --surface debut --candidates 4
 *
 * A single shot of a distilled model is a lottery. This wraps the desk in a loop instead:
 *
 *   1. print N candidates (different seeds) with the same look-spec prompt
 *   2. run the numeric critic (critique.py) as a gate — broken frames die here
 *   3. run the local vision judge (judge.py) as the real score: identity against the reference
 *      photo, lighting, background, composition, artifacts
 *   4. if nothing clears the bar, reprint with a corrective brief (max 2 rounds)
 *   5. keep the winner, write a manifest (scores + seeds + params + spec version) and a contact
 *      sheet so a human can overrule the judge in one glance
 *
 * Quality beats speed on purpose: more candidates and more steps are the two cheapest quality
 * levers a local desk has.
 */

import { execFile } from "node:child_process";
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const run = promisify(execFile);
const HERE = dirname(fileURLToPath(import.meta.url));
const PROJECT = resolve(HERE, "../..");
const PYTHON = process.env.PRINT_DESK_PYTHON ?? "/home/lakshaya/.venv/bin/python";
const JUDGE_MODEL = process.env.PRINT_DESK_JUDGE ?? "/home/lakshaya/models/qwen2.5-vl-3b";

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (!token.startsWith("--")) continue;
    const key = token.slice(2);
    const next = argv[i + 1];
    if (next && !next.startsWith("--")) args[key] = next;
    else args[key] = true;
  }
  return args;
}

const correction = (round) =>
  round === 0
    ? ""
    : "Make the subject unmistakably the person in the reference photo, fill the frame with a head-and-shoulders portrait, light the face clearly and keep the background simple and out of focus.";

async function print({ photo, surface, seed, out, brief, unet, steps, guidance, server }) {
  const cli = ["tools/print-desk/print.mjs", "--photo", photo, "--seed", String(seed), "--out", out, "--surface", surface];
  for (const [flag, value] of Object.entries({ brief, unet, steps, guidance, server })) {
    if (value) cli.push(`--${flag}`, String(value));
  }
  await run("node", cli, { cwd: PROJECT, maxBuffer: 8 * 1024 * 1024 });
  return out;
}

async function gate(file, palette) {
  const { stdout } = await run(PYTHON, ["tools/print-desk/critique.py", file, "--palette", palette, "--expect-portrait"], {
    cwd: PROJECT,
    maxBuffer: 8 * 1024 * 1024,
  });
  return JSON.parse(stdout);
}

/** Unload ComfyUI's models so the judge can have the GPU — the two never need to be resident at once. */
async function freeDesk(server = "http://127.0.0.1:8188") {
  try {
    await fetch(`${server}/free`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ unload_models: true, free_memory: true }),
    });
  } catch {
    /* the desk may be gone; the judge does not care */
  }
}

async function judge(file, reference) {
  if (!existsSync(join(JUDGE_MODEL, "config.json"))) return null;
  const cli = ["tools/print-desk/judge.py", file];
  if (reference) cli.push("--reference", reference);
  try {
    const { stdout } = await run(PYTHON, cli, { cwd: PROJECT, maxBuffer: 16 * 1024 * 1024, timeout: 600_000 });
    return JSON.parse(stdout);
  } catch (error) {
    return { error: error instanceof Error ? error.message.slice(0, 300) : String(error), mean: 0 };
  }
}

async function contactSheet(candidates, out) {
  const script = `
from PIL import Image, ImageDraw
import json
items = json.load(open("${out}.json"))
width, height = 384, 384
sheet = Image.new("RGB", (width * len(items), height + 48), (12, 11, 11))
d = ImageDraw.Draw(sheet)
for n, info in enumerate(items):
    im = Image.open(info["file"]).convert("RGB").resize((width, height))
    sheet.paste(im, (n * width, 0))
    label = f"judge {info.get('judge_mean', '-')}  gate {info.get('gate_score', '-')}  seed {info.get('seed', '?')}"
    note = (info.get("judge_note") or info.get("failed") or "")[:64]
    d.text((n * width + 8, 392), label, fill=(240, 236, 228))
    d.text((n * width + 8, 410), note, fill=(200, 140, 160))
sheet.save("${out}")
print("${out}")
`;
  await writeFile(`${out}.json`, JSON.stringify(candidates, null, 2));
  try {
    const { stdout } = await run(PYTHON, ["-c", script], { maxBuffer: 8 * 1024 * 1024 });
    return stdout.trim().split("\n").at(-1);
  } catch {
    return null;
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.photo) {
    console.error("--photo is required");
    process.exit(2);
  }
  const spec = JSON.parse(await readFile(resolve(PROJECT, "src/look/look.json"), "utf8"));
  const surface = args.surface ?? "debut";
  const registerName = spec.surfaces[surface]?.register ?? "character-shot";
  const palette = args.palette ?? spec.registers[registerName]?.defaultPalette ?? "neon-wet";
  const candidates = Number(args.candidates ?? 4);
  const threshold = Number(args.threshold ?? 6.5);
  const baseSeed = Number(args.seed ?? 0) || Math.floor(Math.random() * 1_000_000);
  const photo = resolve(args.photo);
  const outdir = resolve(PROJECT, args.outdir ?? "print-desk-out/harness");
  await mkdir(outdir, { recursive: true });
  const judging = existsSync(JUDGE_MODEL);
  console.log(judging ? `judge: qwen2.5-vl-3b` : `judge: not installed (${JUDGE_MODEL}) — ranking on the numeric gate only`);

  const history = [];
  for (let round = 0; round < 2; round++) {
    // Phase 1: print the whole batch, so the desk loads its weights once and never competes with the judge.
    const batch = [];
    for (let i = 0; i < candidates; i++) {
      const seed = baseSeed + round * 1000 + i * 17;
      const file = resolve(outdir, `r${round}-c${i}-s${seed}.png`);
      process.stdout.write(`round ${round + 1}/2 · print ${i + 1}/${candidates} · seed ${seed} … `);
      await print({
        photo,
        surface,
        seed,
        out: file,
        brief: round === 0 ? undefined : [spec.surfaces[surface]?.brief, correction(round)].filter(Boolean).join(" "),
        unet: args.unet,
        steps: args.steps,
        guidance: args.guidance,
        server: args.server,
      });
      batch.push({ file, seed, round });
      console.log("printed");
    }

    // Phase 2: hand the GPU to the judge.
    await freeDesk(args.server ?? "http://127.0.0.1:8188");
    for (const item of batch) {
      const gates = await gate(item.file, palette);
      const verdict = await judge(item.file, photo);
      // A judge that crashed is no judge: fall back to the numeric gate, scaled onto the same 0-10 axis.
      const judged = verdict && !verdict.error ? verdict.mean : null;
      const record = {
        ...item,
        gate_score: gates.score,
        failed: gates.failed,
        judge: verdict,
        judge_mean: judged ?? 0,
        judge_note: verdict?.notes ?? verdict?.error ?? null,
        rank: judged ?? gates.score * 10,
      };
      history.push(record);
      console.log(
        `  judge ${record.judge_mean || "-"} · gate ${gates.score}${gates.failed.length ? ` (failed: ${gates.failed.join(", ")})` : ""}${record.judge_note ? ` · ${record.judge_note}` : ""}`,
      );
    }
    const bestThisRound = history.filter((h) => h.round === round).sort((a, b) => b.rank - a.rank)[0];
    if (bestThisRound && bestThisRound.rank >= threshold && !bestThisRound.failed.length) break;
    console.log(`round ${round + 1}: nothing cleared ${threshold} (best ${bestThisRound?.rank.toFixed(2) ?? 0}) — reprinting with a corrective brief`);
  }

  const ranked = [...history].sort((a, b) => b.rank - a.rank || b.gate_score - a.gate_score);
  const winner = ranked[0];
  const final = resolve(PROJECT, args.out ?? "print-desk-out/harness/best.png");
  await copyFile(winner.file, final);

  const sheet = await contactSheet(
    history.map((h) => ({
      file: h.file,
      seed: h.seed,
      judge_mean: h.judge_mean,
      judge_note: h.judge_note,
      gate_score: h.gate_score,
      failed: h.failed,
    })),
    resolve(outdir, "contact-sheet.png"),
  );
  await writeFile(
    resolve(outdir, "manifest.json"),
    JSON.stringify(
      {
        printedAt: new Date().toISOString(),
        surface,
        register: registerName,
        palette,
        specVersion: spec.version,
        candidates: history.length,
        judge: judging ? JUDGE_MODEL : null,
        winner: { file: final, judge_mean: winner.judge_mean, seed: winner.seed, round: winner.round },
        ranking: ranked.map((h) => ({
          judge_mean: h.judge_mean,
          judge: h.judge,
          seed: h.seed,
          round: h.round,
          gate_score: h.gate_score,
          failed: h.failed,
        })),
      },
      null,
      2,
    ),
  );

  console.log(`\nwinner: ${final}`);
  console.log(`  judge ${winner.judge_mean}/10 · seed ${winner.seed} · round ${winner.round + 1}/2`);
  console.log(`  ${winner.judge_note ?? ""}`);
  console.log(`  sheet  ${sheet}`);
  console.log(`  ranked judge: ${ranked.map((h) => h.judge_mean).join(" > ")}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
