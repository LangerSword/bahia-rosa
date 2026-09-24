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

## Swapping the engine

**ComfyUI is an implementation detail, not a dependency of the product.** The app only ever talks to
`/print-desk/*` (Vite proxies it to whatever serves the desk), and `tools/desk/desk.sh` is the only
file that knows ComfyUI exists. Any backend that speaks the same contract is a drop-in:

| the contract | |
| --- | --- |
| `POST /print-desk/upload/image` | multipart image in → `{name}` (the desk's staging area) |
| `POST /print-desk/prompt` | the compiled graph + the reference → `{prompt_id}` |
| `GET /print-desk/progress` | SSE progress (stage, percent, message) |
| `GET /print-desk/history/{id}` | finished plate + the seed and timing the desk reports |
| `GET /print-desk/system_stats` | liveness + VRAM, so the app can say "no desk" honestly |

`frame.py`, `facefix.py`, `identity.py`, `judge.py` and `composite_qa.py` are plain Python and stay
exactly as they are under any engine — they are the quality work; the engine only samples.

**The engines, honestly:**

1. **ComfyUI — what runs today.** Measured here: identity 0.9588 on the author's photo, fp8 4B fits
   8 GB with its offload plumbing, and the graph does multi-reference editing plus the refiner pass.
   Costs a node graph and a server to keep alive (that is what `desk.sh` is for).
2. **`diffusers` — the real alternative.** FLUX.2 [klein] is officially supported (`Flux2KleinPipeline`,
   `pip install -U diffusers`), i.e. the *same model family*, so the look spec and every measurement
   carry over. What it buys: no graph, no server, one process, and the sampler's knobs
   (`HQ_STEPS`/`HQ_GUIDANCE`) become plain numbers instead of graph nodes. What it costs: the ComfyUI
   fp8 safetensors are not diffusers-format, so the weights come down again (~9 GB), and fitting 8 GB
   needs `enable_model_cpu_offload()` plus an int8/fp8 quantized build (a community int8 conversion of
   the 4B exists). A re-validation of identity is owed after the swap.
3. **`stable-diffusion.cpp`** — one binary, GGUF, no Python, fastest start-up; but FLUX.2 support
   trails upstream and the multi-reference edit path we depend on is the part most likely to be
   missing.
4. **A hosted API** (fal / Replicate / Gemini) — deliberately rejected: a key that can expire
   mid-judging, a quota someone else controls, and the project's whole claim ("nothing leaves this
   machine") dies with it.

Verdict: **swap it after the submission, not before.** The measurement work is engine-independent,
and the swap is contained to one file because the contract is the seam. Tonight the desk stays
ComfyUI: it is the configuration whose numbers we actually have.

## Hosting the desk somewhere else

**The desk is an accelerator, not a dependency.** The deployed app prints entirely in the browser — it
always has: MediaPipe finds the subject, and the canvas compositor paints and composes the frame, on the
visitor's own machine, with no key and no upload. What the desk adds is a *different kind of print*: a
diffusion render (FLUX.2 [klein] on a local GPU) instead of a paint, for the plate's own register. So the app
takes the desk's address at runtime and the desk can live anywhere that answers the contract. Two ways, in
order of cost:

### 1. A tunnel from this machine — free

```bash
bash tools/desk/tunnel.sh start      # front door + cloudflared, prints the URL
```

`tools/desk/front.mjs` is the single origin: it serves `/print-desk/*` (ComfyUI), `/restore-desk/*`
(the finisher) and `/health`, adds CORS for the app's origins, proxies the progress WebSocket, and
refuses more than 12 prints an hour per address. Cloudflare reaches it outbound, so no port is opened
and no certificate is needed. Point the deployed app at the printed URL:

```
https://langersword.github.io/bahia-rosa/?desk=https://<something>.trycloudflare.com
```

The address is remembered in `localStorage`, and the intake says where the photo is going. Caveats,
plainly: this machine has to stay awake, and a quick tunnel changes hostname on every restart. For a
stable address, make it a named tunnel on the domain you already have (`cloudflared tunnel create` /
`route dns desk.langersword.in`), then bake it in with `VITE_PRINT_DESK_URL=… npm run build`.

### 2. A rented GPU — ~$1.21/hr while it runs

```bash
bash tools/desk/aws.sh up            # g5.xlarge in ap-south-1, on-demand
bash tools/desk/aws.sh up --spot     # same box, ~$0.48/hr, AWS may reclaim it mid-print
bash tools/desk/aws.sh url           # the desk's public address
bash tools/desk/aws.sh down          # stop paying; the 7 GB of weights stay on the disk
```

ap-south-1 is not a preference, it is the only region where this account has GPU quota (4 vCPUs —
exactly one `g5.xlarge`). The instance has **no inbound rules at all**: it dials out to Cloudflare for
the desk and is reached through SSM for everything else. Two guards keep it honest — a cron that
stops the instance after 20 idle minutes (the front door writes the heartbeat on every print), and
`tools/desk/aws-budget.sh`, which scopes a $15/month budget to EC2 compute with alerts at 50 %, 100 %
and forecasted 100 %.

First boot is ~15 minutes (ComfyUI's requirements, then ~7 GB of weights). After that, `down` then
`up` is ~3 minutes, because the weights are on the instance's own disk.
