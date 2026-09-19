# FIFTEEN MINUTES

**Your face, on everything the city prints.**

A GTA VI-inspired character-debut experience built for the
[Unlayer "Build with React Image Editor" Challenge](https://github.com/unlayer/react-image-editor).

You upload a photo, the city prints you as a character standing in its own light, and then its media
machine wants that face in its own formats: the loading screen, the tabloid front page, the VIP
poster. **React Image Editor is the workstation for every surface**, and each surface hands you a
deliberately different tool set — so "the editor is core" is structural, not a claim.

Nothing about your photo leaves the machine: the print desk runs on your own GPU. There is no account,
no API key, and no upload to anything of ours.

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
- **`tools/print-desk/print.mjs`** — one plate: compile → upload → sample → write with provenance
  (register, seed, spec version in the filename).
- **`tools/print-desk/harness.mjs`** — quality harness: print a batch, gate it numerically
  (`critique.py`), judge it with vision (`judge.py`), keep the best, reprint with a corrective brief
  if nothing clears the bar, and write a contact sheet plus a manifest.
- **`tools/desk/desk.sh`** — start/stop/status for the whole stack.

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
