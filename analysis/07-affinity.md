# 07 — Affinity: Build Pipeline, Design Kit & Component Reuse

## Status (2026-09-10)

Added §1b Design Kit (Affinity's vector/FX/gradient/pattern/type/slice features as
reusable, approved assets), §1c skills-before-scripts, Canva AI Studio hook (23 §4).
Rest of status as of 2026-09-07:

Page-shaped magazine build works (`build()`, `openIssue()`, `buildPage()`, per-page
`placePage`); `renderPage()` exists but is marked unverified. Still: one flat 650-line
`tk.js` prepended to every call, no component library, no `.afdesign` template, text
fit by binary search inside Affinity, MSIX id hardcoded, no font preflight, images are
`cover`/`contain` only (no cutout, wrap, vignette, duotone — needed by 08 §5 / 09 §1),
**no reflow build** for books/shorts (the executor says "nothing lays that out yet"),
no Typst fallback. Priority order now: `T.cutout/T.wrapAround/T.vignette` + world
colours actually applied (unblocks image variety) → reflow autoflow script (unblocks
book print PDF) → component library → node-side text measurement → font preflight.

## Current reality (from affinity.mjs + tk.js)

- Transport: Canva Affinity MCP (`execute_script`, SSE :6767). Preamble handshake per
  session. App launched by hardcoded MSIX id.
- **Every `execute_script` is a fresh JS context.** TK (~600 lines) is re-prepended to
  every script; the document is re-found by a `QUIRE-BUILD` metadata tag; nothing
  survives between calls.
- Text pour = binary search on `overflows()` (many round trips per column).
- Assets must be staged to Desktop (sandbox). PDFs bounce via Desktop. Staging must
  crop cutouts to `subject_box` and keep alpha (09 §0.4); `T.cutout` places the PNG
  by the slot frame, not the raw canvas, so an RGBA asset lands where the layout put it.
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

### 1b. Affinity is more than layout — the Design Kit (added 2026-09-10)

The component library above only covers *page furniture*. Affinity's real range is
vector drawing, pixel compositing, effects, gradients, patterns, typography styles,
symbols, slices and export presets — and every one of those is something an agent
today re-invents per page. The rule the user set: **once made and approved, never
make it again.** Formalised as a **Design Kit**, one per world (magazine section /
book), versioned, approved at the design gate, stored beside the world:

```
<workspace>/design/kits/<worldId>@<v>/
  kit.json            manifest: what is in it, which Affinity families produced it, approval
  swatches.json       paper/ink/hue tints + CMYK intent + named gradients (linear/radial/conical stops)
  text-styles.json    paragraph + character styles for the world's type scale (§4 of the skill)
  fx.json             layer-effect presets: shadow/glow/bevel/outline/3D — allowed set + params
  patterns/           seamless tiles (SVG or PNG) + a `T.pattern()` param record
  vectors/            ornaments, mastheads, rules, icons, mascot silhouettes (SVG + Affinity symbol id)
  masks/              reusable vector masks: vignette, torn-edge, watercolor-bleed, half-bleed shapes
  infographic/        TK infographic components bound to block kinds (bignumber, timeline, vs, process…)
  slices.json         named export slices (cover front/back/spine, social crops) per print profile
  template.afdesign   the world's master doc: masters, styles, swatches, symbols — opened by build()
  previews/           one PNG per asset for the Kit card and the gallery
```

**Affinity feature families the kit captures, and the TK verb that consumes them:**

| Family | What agents produce once | TK / build use |
|---|---|---|
| Vector (pen, shape, boolean, symbols) | ornaments, masthead, frames, icon set, mascot outline | `T.symbol(id, x, y, scale)` — places, never redraws |
| Gradients & swatches | named fills, duotone maps, section-shift bands | `T.fill(role \| gradientId)`; palette locked per world |
| Patterns / textures | seamless tiles, paper grain, halftone | `T.pattern(id, region, opacity)` behind text (≤ 20 %) |
| Layer FX | one approved FX set per world (most worlds: none or a single soft shadow) | `T.fx(presetId)` — anything not in the set is a validator error |
| Pixel / compositing | blend modes, adjustment stacks (curves, duotone), masks; Canva AI Studio ops (23 §4) | `T.img(..., {blend, adjust, mask})`, `T.cutout()` |
| Typography styles | paragraph/character styles for every scale step, drop-cap, kicker, caption | `T.text(style, …)` — text never carries inline overrides |
| Slices / export | per-print-profile slices and presets (PDF/X, PNG @300 dpi, social crops) | `build.export`, `build.derivatives` (23 §6) |

**Lifecycle**: `design.system` proposes the kit (from the world + technique + the
library's nearest existing kit); the design gate shows a **Kit card** (swatches,
gradient strip, pattern tile, ornament row, FX set, type specimen) with keep / edit /
reuse-from-library; approval writes `kit.json.approvedAt`. During build, any new
asset an agent has to draw is **captured on first use** (route A/B above) into the
kit as `draft`, shown on the Beauty gate as "new asset in this page", and promoted
on page approval — so day by day the kit grows and the amount of fresh drawing
falls. The library (`design/kits/`) is browsable, and a kit travels inside a Taste
Pack (18 §7). Canva Brand Kit is a *mirror* of the approved kit, not a source (23 §5).

**Finalise before build**: nothing is laid out until the section's world **and** kit
are approved. The build stage receives specs (design-skill §13) that reference kit ids only;
a spec that names an asset not in the kit is rejected by `checkDesign`, which is what
makes "reuse rather than create" enforceable instead of aspirational.

### 1c. Skills before scripts

Before `design.system` writes a world or a kit, the executor loads, in order: the
`quire-editorial-design` skill (layout, all types) and `quire-illustration` (briefs), the world library,
the nearest kit, `rules.jsonl` for the world scope (18), the Setting Bible §6 props
(22), and the approved copy. The agent finalises *what* the design is (world, kit,
opener grammar, per-page specs) and gets it approved; only then does the deterministic
spec→TK path (§2) touch Affinity. Affinity is the last tool called, never the first.

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

## Print: from PDF to a bound copy (added 2026-09-07; sellable feature 11 #1, #7)

The build gate today ends at a PDF. The product ends at a **book in the post**. All of
this is deterministic and sits in `build.export` after the page/reflow render:

1. **Print profile** per work: `print.json` — trim (A5, 6×9", 8.5×8.5" square for
   storybooks, A4 magazine), binding (perfect / saddle / case), paper stock (gsm, white
   or cream), colour (mono / colour), target service (`lulu` | `ingramspark` | `blurb`
   | `kdp` | `local-print-shop`). Templates (11) preset these.
2. **Spine & cover geometry** from page count × stock thickness (each service publishes
   its formula and a cover-size calculator; encode the tables in `print-specs.json`).
   The cover is a second Affinity build: full wrap with front / spine / back, bleed,
   type-safe area, ISBN barcode (EAN-13 from the user's ISBN, or none), price block.
3. **Preflight** — a deterministic checker on the exported PDF/X: page count parity
   (saddle needs ÷4), bleed present, images ≥ 300 dpi at placed size, fonts embedded,
   colour space per service, no text inside the safe margin, spine text ≥ 0.25".
   Findings surface as build-gate findings with the service's own wording.
4. **Interior/cover export presets** — PDF/X-1a or X-4 as the service requires
   (Affinity export settings are scriptable; Typst fallback covers X-4).
5. **"Order 1 copy"** — for services with an API (Lulu has a print API; Blurb has an
   upload API) submit interior + cover and show the order status on the creation; for
   the others produce a *ready-to-upload* folder with a checklist. Never charge or
   submit without an explicit confirmation card showing price and address.
6. **Bilingual facing-page imposition** (11 #7): the reflow build takes two chapter
   streams (source + translation type output), pours them into left/right frames of
   each spread with paragraph-level sync (translation units already align by chapter;
   add paragraph anchors in the translation runner), one world, one print file.

## Build order

0. Print profile + spine/cover geometry + preflight checker (needs reflow build first for books; magazine can start now). — M
1. Fix renderPage / rasterize fallback (PDF page → PNG via pdftoppm if the API stays unverified). Precondition for `scorePage`. — S
1b. `measurePage(png, spec, assets)` → design-skill §12b dimensions (ink centroid, whitespace %, colour shares in OKLCH, off-palette %, contrast samples) in Node with `sharp`; `scorePage` = measure + spec checks + cause routing; `pages/<nn>/score.json`. Spec-only subset runs as spec-lint before build (09 §0.3b). — M
2. Template .afdesign (masters, styles, swatches) → becomes the kit's `template.afdesign`. — M
3. **Design Kit** manifest + library dir + Kit card at the design gate; component registry + capture-on-first-use writes into the kit (§1b). — M
4. `T.symbol / T.fill(gradient) / T.pattern / T.fx / T.text(style)` verbs reading the kit; `checkDesign` rejects non-kit assets. — M
5. Node-side text measurement. — M
6. Spec→TK generator from the skill's `spec.json` (design-skill §13). — L
7. Canva AI Studio probe for `T.cutout` (23 §4). — S
8. Typst fallback renderer. — L

Status line for the top of this file: everything from 1b onward is **not started**;
`tk.js` motifs are the seed of route B and the only reusable pieces today.
