# The print desk — offline plate generation

**Every image in this project is made without an API key, an account, or a server.**

The print desk turns a photo into a stylised character plate by running **FLUX.2 [klein] 4B** on
your own GPU. It is the same model family the project originally called through a hosted API; the
local build exists because a hosted route means a credential that can expire, a quota someone else
controls, and a dependency the submission does not need.

| | |
| --- | --- |
| Model | `FLUX.2 [klein] 4B` — distilled 4-step, unified generation + **multi-reference editing** |
| Licence | **Apache-2.0** for the 4B weights (no account, no license click-through) |
| Runs on | ~8 GB VRAM (fp8 weights); 6 GB with the Q4_K_M GGUF build |
| Cost | $0 per plate, no quota |

## Bring it up

```bash
./tools/print-desk/fetch-models.sh --gguf      # ~7 GB fp8 + 2.6 GB GGUF build
# then start ComfyUI normally (it serves the HTTP API on 127.0.0.1:8188)
python main.py --listen 127.0.0.1 --port 8188
```

## Generate a plate

```bash
node tools/print-desk/print.mjs \
  --photo ~/me.jpg \
  --out public/art/demo/me.png \
  --brief "head and shoulders, flat deep-maroon field, white line-art city landmarks behind"
```

The script talks to ComfyUI's `/prompt` API with the workflow in
`tools/print-desk/workflow-flux2-klein-edit.json`, waits on `/history`, copies the result to
`--out`, and prints the wall-clock time and VRAM it took.

## What ships in the build

`public/art/demo/` holds the proof plates that ship with the site, plus the demo characters used in
screenshots and the README GIF. They are generated once, by this desk, and committed — so the live
experience needs no GPU and no network.

## Why the live app does not generate

A nano-banana-class restyle needs a real diffusion model. In the page that would mean loading
gigabytes and minutes of compute on a visitor's phone; on a server it would mean holding a key that
can die mid-judging. Both are worse than the honest split:

- **Offline, by the desk:** the plates (this directory).
- **Live, in the browser:** the editorial work — the part React Image Editor exists for, and the
  part the challenge actually judges.

The README states this plainly, including that the desk is reproducible by anyone with an 8 GB GPU.
