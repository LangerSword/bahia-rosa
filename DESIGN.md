# DESIGN.md — NIGHT DESK

The design-system contract for this project. Every component cites a token from here; a value that
appears in code but not here is drift, and one of them gets fixed.

## 0. Research log

| Lane | Source | What was taken | What was left |
| --- | --- | --- | --- |
| Visual language | `rockstargames.com/VI` CSS bundles (fetched, tokens grep'd) | the near-black chrome ramp (`#000`, `#111117`, `#141414`), the single warm brand gold (`#fcaf17`), the 189° deep-tone panel gradients, and the *structure* of deco display over neo-grotesque body | their proprietary GTAArtDeco faces and every asset — structure, not files |
| Reference product shape | the "AFTER HOURS" fan concept (screenshots + copy in the challenge thread) | the *payoff*: what you make gets placed into the fictional city (billboard, venue display, in-world feed) and exported | its name, its copy, its nightlife framing, its artwork |
| Reference product shape | `unlayer/react-image-editor` README + live demo | the tools are the editor's, the app supplies the surface; one tool set per placement | their demo's default chrome |
| Type | Google Fonts (OFL) | Limelight (display), Poiret One (kickers), Inter (text), Pinyon Script (wordmark) | — |
| Skipped | photography/mood-board lane | — | the product *is* the image; a mood board would add nothing the plates do not show |

## 1. Atmosphere & identity

**Three adjectives: printed, nocturnal, civic.** A city's night desk: ink, gold foil, newsprint
texture, the machinery of a place that publishes.

**Taste direction: gold-on-black editorial tabloid.** Not glass, not gradient-purple SaaS, not
cream-and-terracotta editorial (the model's default prior — explicitly rejected here: this surface is
about a city at night, and cream reads as a magazine for a hotel lobby).

**Signature element:** the *plate* — a real photograph of the user, restyled by a local model and
printed with provenance (register · location · seed · spec version) burned into the chrome. A template
cannot have it: it is generated on the machine, for this user, in about a minute.

**Audience:** someone entering a build challenge with 15 minutes of attention; secondarily the judges,
who will see a hundred projects and remember the one that put their own face on a billboard.

## 2. Color

| Token | Value | Role |
| --- | --- | --- |
| `--color-canvas` | `#07070a` | page ground |
| `--color-ink` | `#0d0d12` | panels |
| `--color-ink-2` | `#14141a` | raised panels, inputs |
| `--color-ink-3` | `#1b1b23` | hover, selected rows |
| `--color-paper` | `#f2efe9` | display text |
| `--color-body` | `#cecece` | body text |
| `--color-muted` | `#989898` | secondary text |
| `--color-faint` | `#6f6f6f` | meta, provenance |
| `--color-gold` | `#fcaf17` | the single accent: kickers, rules, focus, the progress bar |
| `--color-rule` | `rgba(242,239,233,0.14)` | hairlines |
| `--color-danger` | `#ef6f6f` | failure text only |
| `--bd-navy` | `189°, #16203f → #0d0c1a` | backdrop: night |
| `--bd-plum` | `189°, #2d1f36 → #0f0c1a` | backdrop: venue |
| `--bd-slate` | `189°, #1f355b → #161733` | backdrop: dusk |

Proportion discipline **60/30/10**: 60 % near-black grounds, 30 % paper/body text and rules, 10 %
gold. Gold never fills a surface larger than a rule, a kicker, or a button.

Contrast floor: WCAG AA. `--color-body` on `--color-canvas` is 12.1:1; `--color-faint` is used only
at ≥11px for provenance and never for instructions; gold on canvas is 9.8:1.

## 3. Typography

Two families plus one wordmark script:

- **Limelight** (display) — Art Deco, the register of a masthead. All-caps, tight leading (0.95),
  used for h1–h2 and placement titles only.
- **Inter** (text) — everything readable: body, controls, captions. Weights 400/500/600.
- **Poiret One** — kickers and labels: uppercase, `letter-spacing: 0.28em`, 11px.
- **Pinyon Script** — the wordmark only, never below 24px.

Modular scale (1.25, base 16): `xs 12 · sm 14 · base 16 · lg 20 · xl 25 · 2xl 31 · 3xl 39 · 4xl 49 ·
5xl 61`. Display line-height 0.95, body 1.6.

## 4. Spacing & layout

Base unit **4px**. Scale `1 · 2 · 3 · 4 · 6 · 8 · 12 · 16 · 24` (4–96px). Container max **1200px**,
page gutter 24px (16px under 640px). Grid: 12 columns desktop, 6 tablet, 1 mobile; panels use a
`minmax(240px,320px) 1fr` split where a figure sits beside controls.

Scroll ownership: the **page** scrolls; panels never scroll internally except the print log and the
feed column, which own their own overflow. Sticky elements: the header only.

Placement canvases are fixed-size and scale to fit their container (`width: 100%; aspect-ratio`), so
the preview never introduces its own scroll.

## 5. Components

Primitives, each with the states listed:

- **Button** (`.lift`) — default (ink-2, rule border), hover (ink-3, gold rule), focus-visible (2px
  gold outline, 2px offset), active (translateY 1px), disabled (40 % opacity, no lift), loading
  (label swaps to a mono progress string, control stays enabled to cancel).
- **Panel** (`.panel`) — ink ground, 1px rule, 2px radius. Variants: default, raised (ink-2),
  backdrop (one of the three 189° gradients).
- **Field** — select/input on ink-2, rule border, gold focus ring, error text in danger below.
- **Plate figure** — the artwork or photo in a rule border with a mono caption strip
  (`the plate · your photo · raw`). Never rounded beyond 2px.
- **Placement frame** — a canvas that draws one artwork into one in-world surface. States: empty
  (dashed rule, "print a plate first"), ready, exporting (mono "rendering…").
- **Kicker** — the uppercase gold label above a title. One per panel, never two.
- **Log line** — mono 11px, faint, newest last, max 6 kept.

## 6. Motion & interaction

Tokens: `--motion-fast 140ms`, `--motion-base 240ms`, `--motion-slow 420ms`, easing
`cubic-bezier(0.22, 1, 0.36, 1)`.

Animate: reveals on scroll (once, 8px rise), the hero sheen (12s loop), the place ticker, hover
lifts, the print progress bar. Never animate: text colour on hover, layout properties, anything that
moves a control under the cursor.

`prefers-reduced-motion: reduce` collapses every duration to 1ms and stops the sheen and ticker.
`tests/e2e/shell.spec.ts` asserts this.

## 7. Depth & surface

No elevation system. Depth is carried by three grounds (canvas → ink → ink-2), hairlines, and the
city's own plates. No blur, no glass, no drop shadows except one: the placement canvases sit on a
2px ink-3 plinth so they read as objects, not as holes.

**The city layer** (added with the launch stage): the page is not a flat field. Behind the hero and
the placement grounds sits one of the repo's own scenery plates — generated by `scenery.mjs`, scenery
only, never a person — at 45–55 % opacity under a scrim gradient, plus two fixed overlays:

- `.grain` — an SVG turbulence at 4–6 % opacity, fixed, `pointer-events: none`, above content but
  below controls. It stops large near-black areas from banding on cheap panels.
- `.vignette` — a radial falloff from the top centre, so the page has a light direction.

Both overlays are `aria-hidden` decoration and neither carries meaning: with them removed the page
still reads correctly. Motion: none. They never animate.

## 8. Accessibility constraints & accepted debt

Honored: keyboard path through the whole flow (upload → print → edit → launch → export); focus-visible
rings on every control; the editor's iframe has a labelled region; every canvas export has a text
equivalent in the DOM caption; colour is never the only signal (the identity verdict is written, not
just coloured); `alt` on every figure.

Accepted debt, with reasons:

- The **editor iframe** is third-party: its internal focus order and ARIA are theirs, not ours. We
  label the region and provide keyboard entry and exit.
- **Placement previews** are decorative composites; their exports are the deliverable, so the preview
  is marked `aria-hidden` with the caption carrying the meaning.
- **Print progress** is announced by a live region at stage changes only, not per step, to avoid
  flooding a screen reader with 26 announcements.
- Contrast for the **gold hairline on ink** is 4.4:1 — below AA for text, fine for a rule; gold is
  never used as small text on ink without going to `--color-gold-ink` (12px+ only, 9.8:1).
