# Portrait generation — where the pixels come from

**Decision (2026-09-19): generation is server-side on Cloudflare Workers AI.** The browser holds no
key; the client's job is intake, downscaling, and handing the result to the editor.

## Flow

```
browser                          Cloudflare Worker (/api/portrait)          Workers AI
───────                          ─────────────────────────────────         ──────────
File → createImageBitmap
     → downscale to ≤512px  ───►  validate · rate-limit · cache lookup ──► FLUX.2 [klein] 4B
     → base64 JPEG                 multipart: prompt + input_image_0        (reference image in,
                                   width 1024 · height 768                   stylised portrait out)
     ◄── { image: base64 }  ◄────  cache write (SHA-256 of the input)   ◄──  base64 JPEG out
```

## Model and why

`@cf/black-forest-labs/flux-2-klein-4b` — FLUX.2 [klein] 4B. It is the cheapest Workers AI image
model that accepts **reference images** (`input_image_0`…`input_image_3`, multipart, each under
512×512), which is the whole product requirement: the character has to be *you*. Fixed 4-step
inference, so latency and cost are predictable.

| Fact | Value | Source |
| --- | --- | --- |
| Input images | ≤ 4 refs, each < 512×512, `input_image_N` naming required | Cloudflare changelog for klein 4B/9B |
| Output size | 256–1920 per side (we use 1024×768) | model page |
| Cost | 5.37 neurons per input 512² tile + 26.05 per output 512² tile → **~83 neurons per portrait** | Workers AI pricing |
| Free allocation | 10,000 neurons/day → **~120 portraits/day** | Workers AI pricing |
| Model call | `env.AI.run(model, { multipart: { body, contentType } })` — binding-based, **no API key in code** | Cloudflare changelog |

Rejected alternatives: `flux-1-schnell` / `dreamshaper` / SDXL / `leonardo/*` (text-to-image only —
no likeness), `@cf/runwayml/stable-diffusion-v1-5-inpainting` (legacy, unpriced, 2022-quality),
Gemini `*flash*-image` (best quality, but the account's prepay credits are depleted), in-browser
MediaPipe + canvas toon (works, free, but the user asked for generation off the client; the module
stays in the repo as an offline fallback and is not registered in `pipeline.ts`).

## Guardrails in the Worker

- **Per-IP budget** (`PER_IP_DAILY_LIMIT = 4`) and a **global budget** (`GLOBAL_DAILY_LIMIT = 250`)
  so a bored visitor cannot burn the day's free neurons. Failures are honest: HTTP 429 with
  `{ error: "rate_limited", scope }`, which the client turns into "the print desk is at capacity".
- **Cache by content hash** — the same photo returns from the Cache API, so retries, refreshes and
  a judge re-running your flow cost nothing.
- **Input limits** — 4 MB body cap, base64 validated, non-JSON rejected.
- The AI binding is scoped by the Cloudflare account, so **there is no secret in the repo, in the
  client bundle, or in `wrangler.toml`.**

## Deploy

```bash
npm run build                 # dist/ (the SPA)
npx wrangler login            # or: export CLOUDFLARE_API_TOKEN=... (Workers Scripts:Edit + Workers AI)
npm run deploy                # wrangler deploy  → serves dist/ + /api/portrait as one Worker
curl https://fifteen-minutes.<account>.workers.dev/api/health
```

`wrangler deploy --dry-run` validates the bundle without credentials — it runs in CI.

## Local development

`npm run dev` serves the SPA only; `/api/portrait` returns 404 until you run the Worker:
`npx wrangler dev` (needs Cloudflare auth and uses the real model).
