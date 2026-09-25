# bahía rosa

**the city prints you. then your poster takes the city.**

one photo in, a painted character portrait out — entirely in the browser. no upload, no account, no api key,
no server in the request path: the segmentation model, the palette, the compositor and the editor all run on
the visitor's machine, and the photograph never leaves the page.

built for unlayer's *build with react image editor* challenge, where `@unlayer/react-image-editor` is the
workstation rather than a dependency of convenience.

live: **https://langersword.github.io/bahia-rosa/**

## gallery

![Lewis Hamilton through the press](docs/gallery/hamilton-at-the-pool.jpg)

*Lewis Hamilton, pressed and set at the pool. Every sponsor mark on the suit survives the palette — hp,
Shell, UniCredit, CEVA, Richard Mille — which is the whole reason the detail pass exists.*

![the group at the beach](docs/gallery/the-group-at-the-beach.jpg)

*a group on the beach plate. A group is **one layer**: it moves, sizes and crops together, because splitting
it would break the continuity of the redraw.*

![the marina at golden hour](docs/gallery/the-marina-at-golden-hour.jpg)

*the marina at golden hour — a subject the press placed in the scene, not one photographed in it.*

### one photograph, and what the press does with it

| in | out |
|---|---|
| ![the photograph as it arrived](docs/gallery/one-photograph-original.jpg) | ![the frame the press made](docs/gallery/one-photograph-pressed.jpg) |
| **in** — the photograph as it arrived: a portrait, 736×1104, stage light already pink | **out** — the frame the press made of it: cut, painted in the hour's light, placed on the neon street, 1600×900 |

*every one of these is a download from the app.* `node tools/paint-photo.mjs <photo>` makes your own, and
[docs/samples/CREDITS.md](docs/samples/CREDITS.md) records where each photograph in this repository came from.

## stack

| | |
|---|---|
| app | react 19 · typescript · vite 8 · tailwind 4 · motion · three (hero canvas only) |
| cut | `@mediapipe/tasks-vision` 1.0 — six-class selfie segmentation, models served from our own origin |
| editor | `@unlayer/react-image-editor` 1.0 — tool sets gated per surface |
| tests | vitest (unit, 154) · playwright (e2e, 16 including a real-touch phone walk) |

## the pipeline

```
photo → cut ──────────► paint ──────► place ──────────────► FORK ─────────► editor ──────► city
        (MediaPipe      (Oklab       (a scene plate or      raw │ edited     (React Image   billboard · venue
         segmenter,      palette,     the visitor's own     │   │            Editor)        feed · postcard
         in-browser)     ink, grain)  room, graded)         │   └─ flatten ──►            + the frame alone
                                                            └─ arrange the subject, in the frame, in the editing phase
```

the invariants, each learned the hard way and each one asserted somewhere in `tests/`:

- **light is decided before anything looks at colour.** a tungsten room and shade both lie about white; the
  cast is pulled toward neutral against the brightest tenth, then a dim frame is lifted by its own histogram
  rather than a constant. measured: a tungsten room's colour error drops 79% (`docs/lighting.txt`).
- **everybody above the noise floor survives the cut** — including a group — and when the model's answer
  swallows the frame (an illustration does this to a photo-trained model), the *confidences* are re-read
  strictly before the press gives up and paints flat.
- **colour work is Oklab, never RGB.** the palette spends its colours where the eye can see the difference.
  measured on a photograph-like frame: 20 colours land within ΔE 0.05 on 97%+ of pixels, 32 on 99.9%
  (`docs/accuracy.txt`).
- **the frame is two layers**: the place with nobody in it, and the person painted on nothing. that is what
  makes a drag move the person instead of the picture, and why the ground must never hold a second copy of
  them.
- **a preview is the exporter.** the canvas on screen and the file you download run the same
  `drawPlacement()`, so a download is the preview at full resolution, not a second rendering of it.
- **the cut is applied to the source, before the fit** — and it is enforced with a floor, because two
  maximum cuts on one axis would otherwise leave a source rect with no extent: a crash inside the painter,
  not a crop (`tests/unit/crop.test.ts`).

## layout

```
src/look/         the press itself
  bodysegment.ts    MediaPipe segmentation → soft alpha, edge refinement, group handling
  stylise.ts        the paint: Oklab palette, ink, grain, the detail pass, all pure functions
  portrait.ts       the compositor: cut, paint, place, the two layers, the final grade
  timeofday.ts      the hour: how a plate is graded for dusk / night / neon
  scenes.ts         the plates, and where a person lands in each

src/world/        the printed world
  compose.ts        layerGeometry / drawPlacement — the one geometry preview and export share
  placements.ts     billboard · venue · feed · postcard, and the arrange FRAME

src/components/   the surfaces a visitor touches
  Arrange.tsx       the arrangement, its outline, and the crop mode
  EditorSurface.tsx Unlayer's editor, tool sets gated per surface
  PlacementCanvas.tsx   a live preview that is the exporter
  PhotoDrop.tsx     drop / paste anywhere, with a hold-and-ask before replacing work

src/lib/          payoff.ts (the remembered arrangement) · photo.ts (intake)
public/models/    selfie_multiclass.tflite (16.4MB) · selfie_segmenter.tflite (249KB)
public/mediapipe/ the wasm runtime (11.7MB), self-hosted so nothing is fetched from a CDN
tests/            unit (vitest) · e2e (playwright) · mobile (touch, 390×844)
tools/            measurement scripts — see below
docs/             accuracy.txt · lighting.txt · look.md · editor-contract.md · print-desk.md
```

## finishes

| | fast | fine | as it is |
|---|---|---|---|
| frame | 1280×720 | 1900×1080 | 1400×788 |
| palette | 20 colours, 8 rounds | 32 colours, 6 rounds | 40 colours, ink 0.06 |
| edge refinement | one pass | three passes | — (no cut at all) |
| subject painted at | 1350px edge | 1500px edge | the frame itself |
| detail pass | 0.92 | off | off |

the same **six-class finder** for both finishes — a cheaper single-class model was tried and its edge is a
blob's edge; speed comes from the palette rounds, the edge passes and the frame size, never from the quality
of the cut. fast's warm press is ~10s and the other two are slower by design; `node tools/press-time.mjs
<url> fast` prints the stage timeline rather than a guess.

## run it

```bash
npm install
npm run dev            # vite, on :5178 (strictPort)
npm run test           # unit; rewrites docs/accuracy.txt and docs/lighting.txt on every run
npm run test:e2e       # playwright — a real browser, the real press; give it memory
npm run build          # tsc --noEmit, then vite build
```

| tool | what it answers |
|---|---|
| `tools/paint-photo.mjs <photo>` | press one photograph and keep everything: the plate and all four city surfaces |
| `tools/press-time.mjs <url> <finish>` | where the seconds go, stage by stage |
| `tools/layer-check.mjs <url>` | did the person move, or the whole picture? |
| `tools/asis-check.mjs <url>` | the "as it is" ground, sampled against the visitor's own room |
| `tools/editor-layers.mjs <url>` | what the editor's layer control actually is, and when it enables |
| `tools/design-check.mjs <url>` | the chrome, measured against the design contract |
| `tools/paint-time.ts` | each paint lever's milliseconds, in isolation |

**if your shell runs `NODE_ENV=production`**, any `npm install` — even with `-D` — prunes the dev
dependencies this repo needs to build and test. use `npm install --include=dev`.

## the editor

the arrangement sits in the same phase as the editor, in the frame above the tools: drag the subject, drag a
corner to size them, drag a cut line to crop. it is drawn from `layerGeometry()` — the same function, the
same arguments, that the exporter draws the person with, so the box in the outline is the box you get.

the **crop button** turns the frame into a crop: cut lines sit on the person where the cut will land, any of
the four drags straight to where you want it, and the same four numbers are on sliders. the lines are drawn
on the *uncropped* extent, which is the part otherwise invisible — the cut is applied to the source before
the fit, so what is drawn is already the cropped person.

each surface hands `@unlayer/react-image-editor` a different tool set (`features.imageEditor.tools`), so
"the editor is core" is structural rather than a claim. its own chrome is theirs, including **flatten
layers**, which stays disabled until there is more than one layer to flatten — measured, not assumed
(`docs/editor-contract.md`).

## on a phone

the flow works on a phone: place, press, compare, arrange, crop, download. no sideways scroll at any stage,
handles and cut lines sized for a fingertip (44px of hit area, a 12px mark), `touch-action: none` on the drag
surfaces so a press-and-drag is a drag and not a scroll. `tests/e2e/mobile.spec.ts` walks 390×844 with
**real touch events** and asserts each of those.

one deliberate exception: unlayer's editor is a 1024×700 desktop surface by contract. on a phone it keeps
that size inside a scroller of its own instead of pushing the page sideways, and the editing phase offers
the arrangement and the city first.

## deployment

github pages, built and published by `.github/workflows/pages.yml` on pushes to `main` only. nothing else
deploys anywhere: no branch previews, no CDN, no functions, no server.

## limits

- **the first press pays for the model**: ~28MB of model and wasm, cached by the browser afterwards. the
  progress line says "loading the segmenter" while it happens.
- **software renderers are slow.** headless chromium without a GPU paints several times slower than a phone
  does; the numbers above are from the machine this was built on.
- **"as it is" prints at the fine finish** because a repainted photograph shows a coarse palette far more
  than a stylised plate does.
- **a group stays one layer.** splitting it would break continuity; the group moves, sizes and crops as one,
  and the line under the frame says "the group" when more than one person was found.

## credits

unofficial, fan-made, not affiliated with or endorsed by rockstar games or take-two interactive. the city
(bahía rosa) and its newspaper (la gaviota) are invented; all visuals are original work. licence:
MIT ([LICENSE](LICENSE)). sample photographs and their provenance: [docs/samples/CREDITS.md](docs/samples/CREDITS.md).