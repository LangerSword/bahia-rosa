# The look spec

`src/look/look.json` is the art direction for the whole project, and it is **load-bearing**: the
print desk compiles each model prompt from it (`src/look/compile.mjs`), so nothing visual ships that
wasn't drawn from this file. Change the JSON, and every future plate changes with it.

## Why JSON, not a prompt string

A prompt string drifts. Six plates in, nobody remembers which palette the loading screen used, and
the compliance rules ("original visuals only, no third-party assets") become something a human has
to re-check by eye every time. The spec fixes both:

- **One vocabulary across the project.** The app's surfaces, the print desk, and the README all
  read the same names: registers, lighting presets, palettes.
- **Compliance is executable.** `compliance.prohibited` is a hard list, and `assertSafe()` throws if
  a compiled prompt contains any of it. The test suite fails the build if a prompt ever leaks a
  franchise term — this is a build gate, not a promise.
- **Provenance is free.** Every plate's filename records register, seed, and spec version
  (`20260919231511-key-art-s84213-v1.0.0.png`), so any image can be traced back to the exact inputs
  that produced it.

## How a prompt is assembled

`compile(spec, { surface })` — or `compile(spec, { register, lighting, palette, brief, seed })` —
walks `promptOrder` and emits the clauses in that fixed sequence:

```
medium → identity → scene → background → lighting → palette → camera → finish → compliance tail
```

Concretely, a loading-screen plate compiles to:

> Render a single image. Medium: Hand-painted cel-shaded character key art for a high-fidelity
> open-world crime drama… **Subject:** Keep the subject's face clearly recognisable… **Scene:** clean
> grade, subject centred, name plate clear. **Background:** Completely flat solid deep-maroon field…
> **Lighting:** Even, soft, directionless studio light… **Palette:** Tropical Art Deco pastels…
> **Camera:** Head and shoulders… **Finish:** Crisp vector-like edges… **Original fan-made artwork,
> invented city and characters, no third-party characters, no franchise marks…**

## The three registers

| Register | Surface | Medium | Default lighting / palette |
| --- | --- | --- | --- |
| `key-art` | Loading screen | Cel-shaded illustration: bold ink linework, flat blocked colour, flat maroon field with white line-art landmarks | `studio-flat` / `deco-pastel` |
| `press-photo` | Front page | Photoreal in-engine-style photograph: ray-traced GI, wet-surface reflections, subsurface skin | `golden-hour-coastal` / `bleached-day` |
| `neon-night` | Poster | Photoreal wet night: LED signage bloom, light cones, city-glow dome, doubled reflections | `dusk-neon` / `neon-wet` |

The vocabulary for the photoreal registers comes from what GTA VI's rendering actually does —
ray-traced reflections as the signature, volumetric subtropical atmosphere, colour bleeding into
shadow, subsurface scattering at ears and nose, and a **present-day** LED night palette rather than
a 1980s sodium-lit one. The pastel Art Deco side is the city's daytime identity.

## Extending it

- **New look:** add a key under `lighting` or `palette`, then reference it from a register's default
  or pass it as an override. `pick()` names the known keys when a key is wrong, so typos fail loudly.
- **New surface:** add it under `surfaces` with a register and a brief; the app and the desk both
  resolve it by id.
- **New register:** add the medium, background, finish, defaults, and a `render` block (`klein` is
  fixed at 4 steps — keep `steps: 4`).
- **Never** add a banned word to the spec's own prose: the compliance gate scans everything that
  reaches a prompt, including the spec's own clauses. (It caught exactly this during authoring.)

## The browser press has its own two finishes

`src/look/look.json` compiles *prompts* for the desk. The in-browser press is a different kind of renderer — a
paint, not a diffusion — so its own look lives in `src/look/stylise.ts` as two presets:

| | fast | fine |
|---|---|---|
| palette | 16 colours, eight rounds | 32 colours, eight rounds |
| smoothing | 0.45 | 0.4 (of the default 0.55) |
| frame (in `portrait.ts`) | 1280×720 | 1900×1080 |
| edge passes | 1 | 3 |

**Fast does not save on the palette.** Both finishes refine the same number of rounds (eight); what fast
spends less on is detail — a 1280px frame instead of 1900, one pass of edge refinement instead of three, and a
smaller paint edge. Measured, not asserted: `tests/unit/accuracy.test.ts` writes `docs/accuracy.txt` on every
run — fast's sixteen colours land within ΔE 0.05 on 97.2% of a photograph-like frame's pixels, and fine's
thirty-two on 99.9%. "As it is" has no finish of its own and no cut: it prints the whole photograph at 1400px
with 40 colours.
