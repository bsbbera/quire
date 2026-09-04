# 07 — Affinity: Optimal Build Pipeline & Component Reuse

## Current reality (from affinity.mjs + tk.js)

- Transport: Canva Affinity MCP (`execute_script`, SSE :6767). Preamble handshake per
  session. App launched by hardcoded MSIX id.
- **Every `execute_script` is a fresh JS context.** TK (~600 lines) is re-prepended to
  every script; the document is re-found by a `QUIRE-BUILD` metadata tag; nothing
  survives between calls.
- Text pour = binary search on `overflows()` (many round trips per column).
- Assets must be staged to Desktop (sandbox). PDFs bounce via Desktop.
- `renderPage()` PNG export is unverified. No component reuse: a wave motif drawn on
  page 3 is fully re-computed and re-drawn on page 40.

The instinct in the user's question is exactly right: **Affinity is a finite tool; the
winning strategy is to stop treating it as a canvas for freehand scripts and start
treating it as a *renderer for a component library*.**

## Layer the pipeline

```
page spec (06)  →  component resolver  →  TK program (deterministic)  →  Affinity
                        │
                        └── component library (versioned, reusable)
```

### 1. Component library (`workspace/design/components/<id>/`)

```json
{
  "id": "wave-rule-03", "kind": "motif",           // motif|frame|infographic|ornament|masthead
  "params": { "width": "cols", "amp": "mm", "color": "role" },
  "impl": "tk",                                     // how it's produced (see routes below)
  "src": "wave(gx(c), y, gw(n), amp, C[role])",
  "preview": "preview.png",
  "usedIn": ["issue-041:p3", "issue-042:p12"],
  "version": 3
}
```

Three implementation routes, in order of preference:

| Route | What | When |
|---|---|---|
| **A. Affinity native assets** | On first build, export the drawn component as an embedded **asset/symbol in a Quire template `.afdesign`**; later pages *place* the asset instead of re-drawing. Master pages for folios/rules/margins. | Static ornaments, mastheads, frames — biggest speed win |
| **B. Parametric TK functions** | Keep as TK code but *registered* with typed params (what tk.js motifs already are — formalize) | Anything data-driven (waves, brackets, rules) |
| **C. Pre-rendered SVG/PNG** | Render once (canvas/sharp/SVG), place as image | Complex infographics, textures, generated art |

Key move: **ship a `quire-template.afdesign`** containing master pages, paragraph/character
styles matching the type scale, swatch palette, and the asset library. `build()` opens
the template instead of creating a blank doc — fonts, styles, palette and reusable
symbols all exist before the first script runs. This alone removes most per-page
scripting and guarantees consistency.

### 2. Deterministic TK programs, not ad-hoc scripts

The layout script for a page should be **generated from the page spec by code, not
composed freestyle by an LLM**. The LLM's creativity belongs in the *spec* (06); the
spec→TK translation is a pure function. Benefits: reproducible pages, diffable builds,
and errors happen in Node (debuggable) instead of inside Affinity's console.

LLM-authored TK is still allowed for *new* components — but the output is captured
into the library (route B) so it is written once, reviewed once, reused forever.
That is the "if one shape is created, never create it again" requirement, made concrete.

### 3. Round-trip reduction (perf)

- **Batch per page:** one `execute_script` per page containing all blocks, not one per
  element. (Mostly true today — keep it.)
- **Kill the binary-search text pour:** measure text in Node instead. Use
  `@napi-rs/canvas` (already a transitive dep) or font metrics (`fontkit`) with the
  known column width/leading to precompute the split point; Affinity then gets the
  final per-column strings in one shot. Fall back to one `overflows()` check as a
  safety assert. This turns ~10 round trips per story into 1–2.
- **State snapshot doc:** after each page, write `build/state.json` (what was built,
  component versions, asset paths) so a crashed build resumes exactly where it stopped —
  the per-page architecture already anticipates this.

### 4. Fix the known gaps

1. **Verify/fix `renderPage()`** — the whole review loop (06) depends on per-page PNGs.
   If `spreadIndex` export doesn't work, fallback: export whole-doc PDF and rasterize
   the one page locally with `unpdf`/`pdfium` (unpdf is already a dependency of inkos).
2. **Font preflight** — doctor check: enumerate required faces from the type scale +
   worlds, verify installed (registry/`fc-list`), block the build with a fix hint
   ("install Lora from Google Fonts") instead of silently substituting.
3. **De-hardcode** MSIX id and port → `platform.mjs` + config.
4. **Desktop hygiene** — clean `Desktop/Quire/<issue>` after successful builds; it's
   currently a leak.
5. **Idempotent page builds** — TK's `kill(tagPrefix)` exists; ensure every element is
   tagged `p07:` so a rebuilt page deletes only itself. (Partly done — make it law.)

## Why not skip Affinity?

Worth stating: a pure-code renderer (Typst/WeasyPrint/InDesign-server) could produce
PDFs without any of this pain. But Affinity gives (a) a real human-editable document —
the user can always open the file and nudge things, which is the ultimate feedback
mechanism, and (b) print-grade export. The hybrid above — code decides, Affinity
renders, human can still touch — is the defensible middle. Keep it, but consider a
**Typst fallback renderer** for users without an Affinity license (same page spec,
lower fidelity) — it also becomes the macOS/CI path.

## Build order

1. Fix renderPage / rasterize fallback. — S
2. Template .afdesign (masters, styles, swatches). — M
3. Component registry + capture-on-first-use. — M
4. Node-side text measurement. — M
5. Spec→TK generator (with 06). — L
6. Typst fallback renderer. — L
