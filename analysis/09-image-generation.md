# 09 — Image Generation: Variety, Treatments, LoRAs, Engines

> Updated 2026-09-07. Verified: `cli-shim/comfy.mjs:160-233` (`generate()` — returns
> seed/workflow, writes **no sidecar**), `cli-shim/workflows/z-image-turbo.json` (the only
> workflow: Z-Image-Turbo fp8 + Qwen3-4B text encoder, no LoRA, 8 steps, negative at
> `:26`), `pipeline/executors.ts:212-288` (`design.generate` → shim, writes
> `<unit>-<slot>.recipe.json`), `pipeline/publication-runner.ts:997-1050` (`artPage` →
> shim, raw `brief.prompt`, no negative, no sidecar), `cli-shim/affinity.mjs:596-624`
> (cover/plate/photo-spread = full-bleed, everything else = top band), `affinity/tk.js:522`
> (`T.img` cover/contain only). No rembg, no alpha, no inpaint, no IPAdapter anywhere.

## Status

| Piece | State |
|---|---|
| Comfy adapter, installer, GPU tiering, workflow registry | done (still the best-engineered part of the shim) |
| Recipe sidecar | storybook/cover path only; magazine `artPage` none |
| Slot/treatment taxonomy driving anything | no — `imageSlot` typed in `DesignSpec`, ignored by layout |
| Transparency / cutout | none — `engines.json` says `transparent: false`; `inpaint: true` has no workflow behind it |
| Edit / extract anywhere in the pipeline | none (§0) |
| Second workflow (Flux, SDXL, inpaint, style-ref) | `albedobase-xl(-style)`, `flux-schnell` JSONs exist; no Qwen, no edit |
| Review grid / gallery / tweak | none (04) |
| Engine settings + workflow manager UI | none (endpoints exist) |

## 0. Element-first pipeline with Qwen-Image-2.1 (added 2026-09-22)

Qwen-Image-2.1 (open weights 2026-09-20; 7B single-stream DiT + Qwen3-VL-8B encoder,
RGBA VAE, native 2K, day-zero ComfyUI) is one checkpoint that does **generate**,
**generate RGBA** (prompt-triggered), **edit** (≤ 10 reference images, local edits by
mask / circle / painted annotation, identity preserved), and **extract** (lift a subject
from a photo into an RGBA layer). Licence: **Qwen Research License — non-commercial
without a separate agreement.** `engines.json` therefore gets a per-workflow
`license: "research-nc"` flag and the UI shows it on the workflow card; commercial
issues must render on Z-Image/Flux-schnell or Canva until a licence exists. The
pipeline design below does not depend on which model fills the slots.

### 0.1 What changes in the flow

Two things were wrong in the earlier plan:

1. **Prompts were written during writing.** Style is chosen *after* the text is
   approved (design system → worlds → kit), and layout decides what shape an image
   must be. A prompt written at writing time cannot know either. Writing now emits
   only **visual hooks** (`hooks[]`: pointable moments + `subjectKey`, no style, no
   shape). Prompts are built at **slot time**, after design.
2. **One picture per slot.** A page is not a picture; it is a *composition* of
   elements Affinity places. The unit of generation becomes the **asset graph**, not
   the slot.

The chain is now:

```
write ──► approve text ──► design.system (world, palette, kit) ──► design.layout
   │  hooks[]                                                           │ slots[] (frame, treatment, alpha, text_zone)
   └───────────────────────────────────────────────────────────────────►│
                                          illustration.plan ◄───────────┘
                                          asset graph (nodes + parent edges + mode)
                                                 │
                                          generate (DAG, parents first, hold children until parent approved)
                                                 │
                                          gallery: keep / redraw / EDIT / EXTRACT
                                                 │
                                          stage (crop-to-object, keep alpha) ──► Affinity place
```

### 0.2 The asset graph

`art/<unit>/graph.json`: nodes with `{id, mode, prompt, refs[], parent, instruction,
slot, alpha, size, status}`. Modes and the **decision rule** that picks them — this is
the "no guessing" table the planner follows top-down, first match wins:

| # | Situation (from slot + hooks + cast) | Mode | Inputs |
|---|---|---|---|
| 1 | Layout sets the type (always) — any text, label, number, pin, key | **none** | layout does it; prompt carries "no text" in the *positive* (cfg 1 ignores the negative) |
| 2 | `treatment` ∈ full-bleed / plate / photo-spread, no cutout derived from it | `generate` RGB | prompt from world fragment + subject; scene size from slot frame |
| 3 | A scene **and** a cutout of something *in* that scene share a spread (same character on the bleed and on the white) | `generate` scene → `extract` child | child = `extract from <scene>: <subject>`; guarantees they match |
| 4 | `alpha: true` and nothing to match | `generate` RGBA | RGBA sentence wrapper; single subject; subject fills ≥ 60 % of frame; rembg skipped |
| 5 | An approved asset exists for `subjectKey` and the brief differs only in pose / expression / prop / facing | `edit` parent | instruction sentence; parent as ref 1; cast refs 2..n; identity preserved |
| 6 | Recurring character, first appearance in this world | `generate` (RGBA if cutout) with cast-sheet refs (08 §9) | `refs[]` ≤ 10, each ≤ 1024 px |
| 7 | Infographic cutaway / diagram | `generate` RGB or RGBA, **no labels** | labels, pins, key = kit components in layout (07) |
| 8 | Magazine `surface: photo` with a licensed real image | place real; `extract` if a cutout is needed | §3 |
| 9 | Small region wrong on an otherwise kept image | `edit` with mask | mask painted in gallery Tweak; parent lineage |
| 10 | Texture / wash / ornament | `generate` RGB (tile) or RGBA (ornament) | seed-locked per world; reused across the issue |

Rules that hold for every node: **never pass a style image to Qwen** — it copies the
objects; style is the world's *written* fragment. Refs are for identity (people,
products, props) only. Each node records `gpuTempC`, `mode`, `parent`, `instruction`
in the recipe sidecar (§4). Reuse before create: the planner queries the kit/gallery
by `subjectKey + world` before adding a `generate` node (illustration-skill §7).

### 0.3 Not everything at once — how the planner sizes the graph

- **Graph is lazy.** `illustration.plan` writes the whole graph but only nodes whose
  slot page is *design-approved* are `status: ready`; the rest are `planned`. The
  queue never renders a `planned` node.
- **Parents first, children held.** Topological order; a child stays `held` until its
  parent is **kept** in the gallery, so a rejected scene does not burn the renders
  built on it. Rejecting a parent re-plans its children (they may become mode 4).
- **Batch by parent.** All `edit`/`extract` children of one parent run back-to-back
  (KV-cache reuse in Qwen makes this cheap; also fewer model swaps).
- **Budget per section.** `maxRenders = pages × 1.5` for magazines, `spreads × 1.2`
  for storybooks; over budget → planner downgrades modes (5 → reuse existing asset,
  3 → 4) and reports what it cut on the Section board.
- **Cross-page dedupe.** Same `subjectKey` + same pose across pages → one node, many
  slots (Affinity places one PNG twice).

### 0.3b Three checkpoints — the pipeline depends on the score

The Page Score (design-skill §12b) is not only a gate at the end; it is split so
cost stops before it is spent:

| Checkpoint | When | Dimensions | Stops |
|---|---|---|---|
| **spec-lint** | after `design.layout`, before any render | G, H (planned shares), T, C (declared), R + accepted lint rules | bad layouts reaching GPU or Affinity |
| **asset-check** | after postprocess, before staging | I: fill, gaze, halo, palette ΔE, dpi at slot size | bad pictures reaching layout; failing → `edit`/`extract`/re-`generate` node, same slot |
| **page-score** | after Affinity `renderPage` PNG | all seven, measured | bad pages reaching the Beauty gate |

Cause routing (design-skill §12b) decides who fixes: only an **I** cause returns to
this asset graph, and only for the failing slot. A layout fault never burns a render.
`asset-check` results are written into the node's recipe so the gallery can show
"fill 0.41 — too small for the slot" on the thumbnail.

### 0.4 Machine layer (`cli-shim`) — from the findings, adopted

| Item | Decision |
|---|---|
| `workflows/qwen-image-21.json` | one file, `mode` ∈ generate / extract / edit selected by the shim; flat `images.image_1..n` reference keys; transparent inputs via `LoadImage → JoinImageWithAlpha`; edit/extract take the latent from the encoder |
| Workflow schema | add `mode`, `refs[]` (was: one SDXL style ref), `maxRefSide: 1024`, `license`, per-workflow `caps` (`transparent`, `edit`, `extract`) — `caps` move from engine to workflow so Comfy can say "transparent: true" only when Qwen is active |
| `postprocess.mjs` | skip white-bg removal when the PNG already has alpha; add `alphaClean` (threshold faint alpha), `cropToObject` (bbox + 2 % pad, writes `subject_box`), `invert` (negatives) — port from `build_pages.py` |
| GPU safety | install GPUThrottle custom node with Comfy; launch with `--vram-headroom 1` at below-normal priority; pre-job wait until ≤ 60 °C, 30 s cool-down after; temp recorded in recipe; refs capped 1024 |
| Gallery | **Edit** (typed instruction → mode 5/9 job) and **Extract** (subject → mode 3 job) beside Redraw; both write `parent` + `instruction` |
| Staging for Affinity | crop to `subject_box` before staging; `T.cutout` keeps alpha; `subject_box`/`gaze` flow back to the design skill handshake (design-skill §11) |

Tests: workflow JSON asserts flat ref keys and `mode` present; postprocess unit tests
for `cropToObject`/`invert` on fixtures; one live chain test (generate → extract →
edit → stage) on the dev machine via `/image/render`, checked over HTTP.

### 0.5 Build order (answer to "which first")

1–5 + 9 from the findings, in this order: **(a)** workflow schema + `qwen-image-21.json`
generate mode + per-workflow caps + licence flag; **(b)** GPU safety; **(c)** postprocess
alpha steps; **(d)** extract + edit modes; **(e)** gallery Edit/Extract buttons. That
makes the chain usable by hand. Then the planner: **(f)** `hooks[]` from writing,
**(g)** `graph.json` + decision table + DAG queue with holds, **(h)** staging crop +
handshake fields. Sidecar-everywhere (§4, task 1 below) is a prerequisite for (e).

## 1. Why everything is full-bleed, and the fix

Two causes, both mechanical: the brief has no `treatment`, and `tk.js` can only
`cover` or `contain` a rectangle. Variety is therefore **not a model problem first**;
it is a pipeline problem. Order of leverage:

1. **Treatment in the brief** (08 §4) — ArtDirector chooses from the table below.
2. **Post-process per treatment** — rembg/alpha, edge masks, paper composite.
3. **Placement grammar in Affinity** (`T.cutout`, `T.wrapAround`, `T.vignette`).
4. **Then** technique LoRAs for looks the base model cannot produce on its own.

### Slot × treatment table (the brief schema uses exactly these ids)

| Slot | Treatments | Post-process | Affinity placement |
|---|---|---|---|
| `opener` | `full-bleed`, `half-bleed-top`, `half-bleed-side`, `vignette` | vignette: radial alpha mask | cover / band / mask |
| `tailpiece` | `spot`, `ornament`, `fade-vignette` | rembg → alpha; ornament: threshold to 1-colour | centred small, ≤ 45 mm |
| `inline` | `cutout`, `watercolor-bleed`, `plate` | rembg; bleed: painted-edge mask (noise-displaced alpha) | wrap-around / framed |
| `margin` | `spot-cutout`, `ornament` | rembg | outer margin, ≤ 30 mm |
| `infographic` | `vector` (TK components, 07), `generated-diagram` | none / rembg | grid-snapped block |
| `texture` | `tile`, `wash` | tile: seamless crop; wash: opacity 12–20% | behind text |
| `photo-spread` (mag) | `full-bleed`, `duotone`, `bleed-with-caption-panel` | duotone: map to world paper/ink | cover + panel |
| `cover` | `full-bleed`, `cutout-on-field`, `typographic` | rembg for cutout | type-safe area enforced |

### Randomisation that is stable and tasteful

A treatment is chosen by the ArtDirector, but the *variety* is guaranteed by a
seeded device roll: `pick(candidates, seed = hash(workId, unit, k))` with constraints
(never the same treatment as the previous unit; ≤ 1 `full-bleed` per 3 units in books;
magazine archetype pacing from 13). Deterministic from the seed so a rebuild reproduces
the layout; a "redesign" bumps the salt. Storybooks alternate full-bleed / vignette on
purpose — variety there is rhythm, not randomness.

## 2. The base model and the LoRA question

**Fact that changes the answer:** Quire renders with **Z-Image-Turbo** (Alibaba
Tongyi, Apache-2.0, ~6B, 8-step). The LoRA you linked —
`Crowbar-Dub/magazine-cutout-flux-lora` — is a **FLUX.1-dev** adapter. It cannot load
on Z-Image (different architecture), and even on Flux it is a poor bet: 4 downloads a
month, zero likes, no sample images on the card, trained on Replicate with trigger
`MGZN`, and the FLUX.1-dev **non-commercial** licence applies to the base it requires.
For a product you sell, do not build on dev-licensed Flux at all.

So three routes, in order:

| Route | What | When |
|---|---|---|
| **A. Post-process, not LoRA** | Cutouts, bleeds, paper texture, duotone, torn edges are all *compositing* operations (rembg + masks + Affinity blend modes). This is 80% of the "magazine cutout" look and needs no training. | first — ships with §1 |
| **B. Technique LoRAs on a commercial-safe base** | Add a second workflow for a base with an open licence that has a LoRA ecosystem: **FLUX.1-schnell** (Apache-2.0) or **Qwen-Image** (Apache-2.0), or Z-Image LoRAs as that ecosystem grows (ai-toolkit supports Z-Image training). Curated pack, one per technique the pools (08) name: paper-cut (e.g. Norod78 Paper-Cutout-Style, Flux), collage (lyraaaa/flux-collage-v1), riso, linocut, watercolor. Every LoRA entry records licence + trigger + strength in `workflows/loras.json`; the world's `technique` maps to a LoRA id when the active base has one, else to prompt words. | after two bases exist |
| **C. Train our own** | Yes, feasible and the right long-term move: 30–60 images per technique, captioned with a trigger + content, trained with ai-toolkit (Flux-schnell / Qwen-Image / Z-Image, ~1–2 h on a 24 GB GPU or ~$5 on a rented one). **Data source that makes it defensible:** the user's own **approved Gallery images** (04) — the taste engine (18) already collects "kept" verdicts per world; a world with ≥ 40 kept images can train a *personal world LoRA* so the look stays consistent across an issue or a series. Public training images need licence checks; approved generated images do not. | once gallery + taste exist |

Newer/better public datasets: nothing curated exists for "magazine cutout" as a
dataset; what exists are individual LoRAs (above). Building the dataset from approved
outputs is better than any public set because it encodes *this user's* taste and the
exact print use.

### Workflow additions (JSON files, not engines)

`flux-schnell` / `qwen-image` (LoRA-capable base) · `z-image-turbo-lora` (when Z-Image
LoRA loader is stable) · `rembg-birefnet` (post-process: PNG → alpha PNG) · `inpaint`
(region tweak) · `ipadapter-style` (condition on world references / refs, 08 §3) ·
`upscale-2x` for covers and plates (print at 300 dpi needs ~2500 px on A4 width).

## 3. Real photographs for magazines

`surface: photo` briefs (08 policy allows only for `publication`, `interactive-film`)
take two paths, chosen by the ArtDirector's `reference` field:

- **Generated photoreal** — Z-Image/Flux with the photo surface default
  ("documentary photograph, natural light, 35mm") and the anti-illustration
  negative. Good for mood, unusable for a *specific* real thing.
- **Real reference / real image** — `reference: {kind:"web", query, license:"cc"}` →
  a search tool queries **Openverse** (CC-licensed aggregate) and **Wikimedia Commons**
  first, stores 1–3 candidates in `art/refs/<unit>/` with `source.json` (URL,
  licence, attribution). Two uses: (a) condition generation (IPAdapter) so the
  generated machine/animal/map is accurate; (b) **place the real photo** when the
  licence allows and the user approves it in the gallery — the sidecar then carries
  attribution, and the build adds the credit line automatically. Never place a
  non-licensed image; never fetch faces of private people.

### 3b. Character reference conditioning (for the Cast Sheet, 08 §9)

The `ipadapter-style` workflow takes `refs[]` on the render request; for character
briefs the refs are the sheet's `ref-front/side` PNGs with a face/identity weight
(IPAdapter-FaceID or the base model's native reference channel — Flux Redux / Qwen-
Image-Edit reference, Z-Image as its ecosystem lands) and the world refs at style
weight. Two knobs in the recipe: `identityWeight` (0.6 default; storybooks 0.75) and
`styleWeight`. The sidecar records the sheet version used, so "regenerate with the new
sheet" is a filter over `refs`. When no reference-capable workflow is active, the
seam falls back to the sheet's trait line in the prompt and marks the recipe
`identity: "prompt-only"` so the coherence audit knows to look harder.

## 4. Sidecar everywhere (04) — the precondition for all of the above

Move sidecar writing into `comfy.generate()` (or a core `renderImage()` wrapper) so
`artPage`, `design.generate`, and the MCP tool all produce `*.recipe.json` with:
`engine, workflow, model, loras[], prompt (composed + components), negative, seed,
size, steps, surface, slot, treatment, world, brief path, post-process[], refs[],
parent (for variants/inpaints), at`. Without this, no gallery, no regenerate, no
taste, no LoRA dataset.

## 5. Engines beyond Comfy (updated 2026-09-10)

- **Do not** add a second local engine; add workflows. MLX (`mflux`) only with the
  macOS port (11).
- **Canva** (23 §3) is the first *hosted* engine, because the user already pays for it:
  `engines.json` registry, `renderImage()` router with **capability gating** (briefs
  needing refs/inpaint/seed never go to Canva) and **quota fallback** — on Canva's
  allowance error or the local counter hitting the plan limit, the same job re-routes
  to Comfy and the gate card shows "Canva AI allowance used up — routed to ComfyUI".
  Tiers (Free 50 lifetime / Pro ~200 premium uses a month shared with Affinity's AI
  Studio) come from the connection card; Canva exposes no remaining-allowance API.
- **fal.ai / Replicate** as the second API engine for GPU-less users (~150 lines behind
  the same seam); unify the separate cover-provider system (`llm/cover-providers.ts`)
  into it.
- Midjourney: no API; document user-installed MCP at their own risk, do not ship.

### 5b. What gets illustrated, per type (the sensing rule)

All art is derived from **approved text** — the ArtDirector reads the unit, never a
synopsis. Per type:

| Type | World | Illustration character | Attention device | Prompt changes |
|---|---|---|---|---|
| Magazine | per **section** (13) | design-heavy: many illustrations + infographics + typographic pages; realism allowed only for `surface: photo` | section opener, specimen poster, one break per section | every section: new fragment, palette, technique, kit ids |
| Storybook | per work | storytelling: one beat per spread, the child's eye level, recurring cast (08 §9) | **cutout on white** alternating with full-bleed | stable fragment; treatment and subject vary |
| Book / short | per work | sparse, quiet: opener/tailpiece/plate, many chapters none | a single cutout or spot where the chapter turns | stable fragment; slot varies |
| Storyboard | per work | line/tonal panels | — | stable |

The `subject` in a brief is a sentence a reader could point to in the text ("Mira
lifts the lantern over the flooded stairs"), plus `subjectKey` for kit reuse. Mood
words belong to the world, not the brief.

## 6. UI (04 owns the gallery; this file owns the engine surfaces)

1. **Engine settings** — Comfy install/benchmark status (the 11 GB download is still
   invisible), GPU tier, API keys for fal, default base per surface.
2. **Workflow & LoRA manager** — list/enable/strength; endpoints exist for workflows.
3. **Tweak mode** — brush region → inpaint recipe with parent lineage (in the gallery).

## 7. Implementation order

| # | Task | Test |
|---|---|---|
| 1 | Sidecar in the shared render seam; `artPage` uses it | magazine image has recipe.json |
| 2 | `treatment` in brief; `rembg-birefnet` workflow; mask post-processes (vignette, bleed edge, duotone) | tailpiece renders as alpha PNG |
| 3 | `T.cutout/T.wrapAround/T.vignette` + placement grammar (08 §5) | inline cutout page with text wrap |
| 4 | Seeded device roll with constraints | 10-chapter book: no two adjacent identical treatments |
| 4b | Qwen-Image-2.1 workflow (generate/extract/edit), per-workflow caps + licence flag, GPU safety, alpha postprocess, gallery Edit/Extract (§0.4–0.5 a–e) | live chain generate → extract → edit → stage over `/image/render` |
| 4c | `hooks[]` from writing; `graph.json` planner with decision table, DAG holds, budget; staging crop + handshake (§0.2–0.3, f–h) | rejected parent leaves children `held`; storybook spread: scene + matching extract |
| 5 | `flux-schnell` or `qwen-image` workflow + `loras.json` + technique→LoRA map | world technique "paper-cut" loads the LoRA |
| 6 | Openverse/Commons reference search + `art/refs` + attribution in build | photo brief yields licensed candidates |
| 7 | Engine settings + workflow/LoRA manager UI; per-surface default engine | — |
| 7b | `engines.json` + `renderImage()` router + Canva engine with capability gating and quota fallback (23 §3) | forced quota error → Comfy image, sidecar `fallbackFrom: canva` |
| 8 | Inpaint workflow + tweak mode | — |
| 9 | Personal world LoRA training job from ≥ 40 kept images (after 04 + 18) | — |
