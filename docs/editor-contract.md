# React Image Editor — verified contract

Everything in this file was read from the official sources on **2026-09-18/19** (repo README,
package metadata via the npm registry, and Unlayer's own agent skills at
`github.com/unlayer/unlayer-skills`). No part of it is inferred from blog posts.

## Package

| Fact | Value |
| --- | --- |
| Package | `@unlayer/react-image-editor` |
| Version verified | `1.0.2` (published 2026-08-31) |
| Peer requirement | `react >= 18` |
| Licence | MIT |
| Editor runtime | loaded from `cdn.unlayer.com` → **the page needs internet** |

## Props

| Prop | Type | Notes |
| --- | --- | --- |
| `image` | `string` (required) | image URL **or base64 data URL** — this is why the portrait pipeline can stay serverless |
| `options` | `ImageEditorOptions` | `theme`, `locale`, `translations`, `features`, `projectId`, … |
| `editorId` | `string` | cosmetic container id; the editor mounts by element reference |
| `minHeight` | `number \| string` | defaults to `500`; use `720px`+ in this project |
| `style` | `CSSProperties` | container styles |
| `onLoad` | `(editor) => void` | called with the editor instance once mounted |
| `onSave` | `({ dataUrl, blob }) => void` | the game grades `dataUrl`; `blob` is what you would upload |
| `onCancel` | `() => void` | |
| `onLoadError` | `() => void` | image fetch / decode / 404 — **distinct** from wrapper failures |
| `onError` | `(error: Error) => void` | embed script load, editor creation, lifecycle |
| `ref` | `-> { editor }` | instance after mount |

## Instance methods

`getImage()` · `hasChanges()` · `reset()` · `updateOptions()` · `destroy()`

## Tool gating (how level design works here)

Free manual tools: `filter`, `crop`, `resize`, `draw`, `text`, `shapes`, `stickers`, `frame`
(+ `corners` inside crop).

**Confirmed in practice (2026-09-19):** Unlayer's own demo builds the payload as
`features: { imageEditor: { dock, tools } }` with `tools` a `Record<ToolName, boolean>`
(`demo/src/App.tsx` line 164 and `demo/src/Sidebar.tsx` `TOOL_NAMES`) — `true` keeps a tool,
`false` removes it from the rail. This is the form used by `src/components/EditorSurface.tsx`.
The docs additionally document an object form (`filter: { icon }`, `stickers: { enabled: false }`)
for icon overrides. The demo also passes `dock` directly, so dock is runtime-supported.

The AI Assistant is paid and requires `projectId`; without it the assistant stays hidden. This
project does not use it.

## Remount semantics (why surfaces remount)

Changing `image`, or any `options` key other than `theme` / `locale` / `translations`, **destroys and
recreates** the editor. Tool gating therefore lives on a remount keyed by surface id rather than on
mid-session option patching.

## Typing gaps

`features.imageEditor.dock` (`'left' | 'right'`) and the `corners` tool config are supported at
runtime but absent from the shipped `@unlayer/types` declarations, so they need a cast (or omission)
when passed through React options.

## Cost and quota facts relevant to this project (historical)

- All manual tools are free. The AI Assistant is paid, requires `projectId`, and is **not used**.
- Hosted image models were evaluated and rejected: Gemini `gemini-3.1-flash-lite-image` ($0.0336 /
  1K) is blocked on depleted prepay credits, and Cloudflare Workers AI's cheap image models are
  text-to-image only (no reference image → no likeness); its reference-image model
  (`@cf/black-forest-labs/flux-2-klein-4b`) is exactly the model this project now runs **locally**
  instead. See `docs/print-desk.md`.
