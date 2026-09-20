# FIRST EDITION

**The city prints you.**

A GTA VI-inspired character-debut experience built for the
[Unlayer "Build with React Image Editor" Challenge](https://github.com/unlayer/react-image-editor).

You bring one photo, the city prints you as a character standing in its own light, and then its media
machine wants that face in its own formats: the loading screen, the tabloid front page, the VIP
poster. **React Image Editor is the workstation for every surface**, and each surface hands you a
deliberately different tool set — so "the editor is core" is structural, not a claim.

Nothing about your photo leaves the machine: the print desk runs on your own GPU. There is no account,
no API key, and no upload to anything of ours.

![The shell](docs/ui-revamp.png)

## The design language

The chrome is measured from the studio's own site rather than guessed at (tokens and CSS read from
`rockstargames.com/VI`):

| Token | Value | Where it came from |
|---|---|---|
| canvas | `#07070a`, panels `#0d0d12` / `#14141a` | their near-black chrome (`#000`, `#111117`, `#141414`, `#222`) |
| text | `#cecece` body, `#989898` muted, `#f2efe9` display | their text ramp (`#cecece`, `#989898`, `#ebebeb`) |
| accent | `#fcaf17` | their single warm brand gold |
| backdrops | 189° gradients — navy `#16203f→#0d0c1a`, plum `#2d1f36→#0f0c1a`, slate `#1f355b→#161733` | their deep-tone panel gradients |

Type is an Art Deco display face over a neo-grotesque, which is their structure (a deco display over
Helvetica Now). The open equivalents here are **Limelight** (display), **Poiret One** (kickers),
**Inter** (text) and **Pinyon Script** (the wordmark) — all OFL, all self-hosted in `public/fonts/`,
so nothing is fetched at runtime and no proprietary face is copied.

Motion is a library, not a hack: `motion` (Framer Motion) drives reveals, the hero sheen and the
ticker, and everything collapses under `prefers-reduced-motion`. `tests/e2e/shell.spec.ts` asserts the
tokens render, the fonts load, no request leaves the origin, and reduced motion is respected.

## Run it

```bash
npm install
bash tools/desk/desk.sh setup     # one-time: the venv ComfyUI runs in + the desk's own tools
bash tools/desk/desk.sh start     # print desk on :8188, app on :5178, waits for both to answer
bash tools/desk/desk.sh status    # ports, pids, model count, GPU
bash tools/desk/desk.sh stop      # stops both, and proves the ports are free
```

`npm run desk`, `npm run desk:status`, `npm run desk:stop` and `npm run desk:logs` wrap the same script.
The desk is ComfyUI (`COMFY_DIR`, default `~/comfy/ComfyUI`) running FLUX.2 [klein] 4B locally; the app
proxies to it through `/print-desk`, so the browser never talks cross-origin.

## The pipeline

```
photo → frame.py ──► print.mjs ──► plate ──► editor
        face detect    look spec      |         React Image Editor
        + crop         + klein        └─ harness.mjs: best-of-N, gated and judged
```

- **`tools/print-desk/frame.py`** — finds the face (frontal → alt → profile) and crops to a
  head-and-shoulders frame before the model sees anything. A face filling 4% of a landscape photo
  prints as mush; framed, it prints as a portrait. Every crop decision is reported as JSON.
- **`src/look/look.json`** — the look spec, and the single source of truth for how anything here
  looks: registers (character shot, key art, press photo, neon night), lighting presets, palettes,
  identity rules and the compliance floor. Prompts are *compiled* from it by `src/look/compile.mjs`,
  never written by hand, and a test enforces that every compiled prompt stays inside the budget a 4B
  distilled model actually reads.
- **`tools/print-desk/print.mjs`** — one plate: compile → upload → sample → restore the face from the
  photo (`facefix.py`: eye-aligned, full-resolution, colour-clamped, Poisson-blended) → write with
  provenance (register, location, seed, spec version in the filename). `--hq` switches to the base
  model at 26 steps and guidance 1.0 for quality over speed.
- **`tools/print-desk/identity.py`** — ArcFace identity and landmark geometry against the photo.
  Calibrated on this pipeline: the raw model output measures 0.083 cosine (a different person), the
  face-restored plate 0.69. This is the harness's strictest gate.
- **`tools/print-desk/harness.mjs`** — quality harness: print a batch, gate it numerically
  (`critique.py`), judge it with a local vision model (`judge.py` — Qwen2.5-VL in 4-bit, scoring
  identity, lighting, colour, background, composition and artifacts against your reference photo),
  measure identity with `identity.py`, and rank **identity first**, then the judge, then the gate.
  Locations rotate across candidates so a batch shows the city, not one street.
- **`tools/desk/desk.sh`** — start/stop/status/warm for the whole stack.

Generated plates, framed references and comparison sheets land in `print-desk-out/` (gitignored):
`plates/` for finished work, `harness/` for batches, `compare/` for side-by-sides, `refs/` for crops.

## What you choose in the app

| Choice | Options | What it does |
|---|---|---|
| Style | Character shot · Loading screen · Poster · Press photo | Picks the register — a photoreal character portrait, a painted loading-screen panel with a clear band for your name, a night poster, or a tabloid photo |
| Location | Rotate (7 places) · Palm boulevard · Marina pier · Downtown canyon · Rooftop · Night market · Seafront road · Hillside overlook | Where the subject stands; "rotate" lets the desk choose per print so you never get the same street twice |
| Quality print | off / on | Base model at 26 steps instead of the fast 4-step distilled one — slower, sharper, better light |

Every option is read from `src/look/look.json`, so the UI and the desk can never disagree about what
a "location" or a "style" is.

## How the editor is used

React Image Editor (`@unlayer/react-image-editor`) is the only thing the player *produces* with. Its
tools are load-bearing per surface: each surface ships a different `features.imageEditor.tools` map,
the saved pixels are what the game grades, and the brief changes what a good result even means.

## Status

**In active development.** This repository is private while it is being built and goes public before
submission. Working end to end today: intake with face framing, the local print desk, live in-app
printing with real progress, and the editor mounting on surface 1. Still being built: the grading
engine, and surfaces 2–4.

---

Unofficial fan-made project for the Unlayer Build with React Image Editor Challenge.
Not affiliated with, endorsed by, or connected to Rockstar Games or Take-Two Interactive.
All visuals are original work; the city (Bahía Rosa) and its newspaper (LA GAVIOTA) are invented.
