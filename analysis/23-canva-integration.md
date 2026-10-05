# 23 — Canva: What a Pro Plan Buys Quire, and Where It Plugs In

> New 2026-09-10. The user has **Canva Pro**. Affinity is already Canva's (the Affinity
> MCP bridge in `cli-shim/affinity.mjs` is the current build transport, 07). This plan
> answers: what does Canva add, where does it sit in the content → design → build
> workflow, how do we route around its limits, and can Quire ship as a Canva extension.
> Facts below checked against canva.dev docs and Canva Help Center on 2026-09-10; plan
> limits change — re-verify before implementing quota logic.

## Status (2026-09-11)

**Done:** §3 — `cli-shim/engines.json` registry, `engines.mjs` router with capability
gating and same-job quota fallback, `canva.mjs` (remote MCP for the picture, REST
for the export), local allowance counter, `quota` in the error taxonomy, the
Picture engine card in Connections, and every render path moved to
`POST /image/render`. Untested against a live Canva account — there is no token
on this machine, so the Canva branch itself has never run.

**Not done:** §4 AI Studio probe in Affinity, §5 Brand Kit mirror and stock
search, §6 derivatives and the Apps SDK app. OAuth is a pasted token, not a
flow.

## 0. Verdict first

Canva is **not** a replacement for Affinity as the print renderer, and its
template autofill is **Enterprise-only**, so it cannot be Quire's layout engine for a
Pro user. It *is* worth integrating as four things:

| Role | Surface | Plan needed | Value to Quire |
|---|---|---|---|
| **A. Second image engine** with automatic fallback to ComfyUI | Canva AI (Magic Media / "Create an image") via MCP `generate-design` → export PNG, or via the Canva AI Studio *inside Affinity* | Pro+ (Free: 50 lifetime) | Users without a GPU get illustrations day one; Comfy stays the unlimited path |
| **B. Compositing tools inside Affinity** | Canva AI Studio in Affinity: Remove Background, Select Subject, Generative Fill / Expand / Edit, Generate Vector | Pro+ | Cutouts and clean edges without shipping rembg; vector ornaments |
| **C. Asset & brand store** | Connect API / MCP: asset upload, folders, Brand Kit (fonts, colours, logos), 100M+ stock library | Pro for Brand Kit; Enterprise for brand templates | The Design Kit (07 §1b) mirrored where the user's other tools already look; stock photos for `surface: photo` |
| **D. Derivative & distribution outputs** | MCP `generate-design`, `resize-design` (Pro+), export PDF/PNG/PPTX/MP4/HTML | Pro for resize | One click from an approved issue to promo carousel, cover reveal, newsletter header, presentation of the book |

Everything else Canva offers (Docs, Whiteboards, Presentations as content, Magic
Write) is out of scope — Quire's writing and layout are better.

## 1. Facts that shape the design (verified)

- **Remote MCP** `https://mcp.canva.com/mcp`, OAuth2 with dynamic client registration;
  ~32 tools: `generate-design`, `generate-design-structured`, editing transactions
  (`start/perform/commit-editing-transaction`), `search-designs`, `get-design-content`,
  `export-design`, `resize-design`, `upload-asset-from-url`, folders, comments,
  design import from URL. Autofill / brand templates / brand kit tools: **Enterprise**.
  Resize: **Pro and above**. Works from Claude Code / Desktop and any MCP client;
  `mcp-remote` for stdio-only agents — the shim's MCP hub (`mcp.mjs`) can host it.
- **Connect API** (`api.canva.com/rest/v1`): `POST /designs` (preset type or custom
  W×H up to 8000 px / 25 MP, optional `asset_id`; blank designs auto-deleted after
  7 days), asset upload jobs, export jobs (PDF/JPG/PNG incl. transparent PNG, per-page
  selection; URLs valid 24 h), folders, comments. Autofill needs Enterprise.
  No element-level layout API — placing text at x,y with a given font is **not**
  possible outside the editing-transaction MCP tools, which are prompt-driven.
- **AI allowance** is one shared monthly pool: Free 200 standard / 20 premium uses;
  **Pro 2,000 standard or 200 premium or 20 ultra**; Business/Enterprise double.
  Magic Media text-to-image alone: Free 50 lifetime, Pro 500/month. Premium tools
  include "Create an image with Canva AI", Generate elements, and the **Affinity
  premium AI tools** (Generative Fill/Expand/Edit, Generate Images and Vectors) —
  those draw from the same pool. **There is no API that returns remaining allowance**;
  exhaustion surfaces as an error. No overage purchase on Pro.
- **Affinity** (unified app) is free with any Canva account; the Canva AI Studio in it
  needs a premium plan. Affinity's own vector/pixel/layout tools are never metered.
- Canva Apps SDK ("apps" that run *inside* the Canva editor) is separate from the
  Connect API; apps can add content, read/write the current design, and call a
  backend — this is the "extension" route (§6).

## 2. Where Canva sits in the Quire workflow

```
CONTENT ──gate──► DESIGN ─────────────────────────gate──► BUILD ──gate──► FINAL
                  │ design.system  worlds + Design Kit           │ Affinity (print)      │
                  │   └ Brand Kit sync (C)                       │   └ Canva AI Studio   │
                  │ design.artplan briefs                        │      for cutouts (B)  │
                  │ design.generate ── engine router ───────────►│                       │
                  │      comfy | canva (A) | fal                 │ build.derivatives     │
                  │ design.review                                │   └ Canva (D)         │
```

Canva never owns a gate. It is an **engine** behind `renderImage()` (09 §4), a
**tool** inside the Affinity build, a **mirror** of the kit, and a **post-build
step** for derivatives.

## 3. A — Canva as an image engine with quota fallback

Implements the user's rule: *if the Canva limit is over, an error message should come
and route to ComfyUI automatically.*

### 3.1 Engine registry (`cli-shim/engines.json`, same shape as `providers.json` in 20)
```json
{ "id": "canva", "kind": "image", "auth": "oauth-canva", "surfaces": ["illustration","photo","typographic"],
  "caps": { "maxSide": 2048, "transparent": true, "styles": true, "refs": false, "inpaint": false, "seed": false },
  "quota": { "period": "month", "premiumUses": 200, "resetUtc": "last-day", "track": "local" },
  "cost": { "unit": "premium-use", "perImage": 1 } }
```
Comfy stays `{ id: "comfy", quota: null, caps: { refs: true, inpaint: true, seed: true, loras: true } }`.

### 3.2 Router (`renderImage(recipe)`, core)
1. Resolve the preferred engine for this recipe: user preset per surface
   (Engine settings, 09 §6) → world default → `comfy`. Capability check: a brief that
   needs `refs` (Cast Sheet, 08 §9), `inpaint` (tweak), or reproducible `seed` is
   **never** sent to Canva — silently routed to Comfy with `recipe.engine.reason`.
2. Call Canva through the shim: `generate-design` (custom W×H design, prompt =
   `composeImagePrompt()` positive; Canva has no negative prompt — the policy block is
   rewritten as "no photorealism, no 3D" in the positive) → poll → `export-design`
   PNG (transparent when treatment ∈ cutout/spot/ornament) → download to
   `<unit>/art/` with the sidecar (`engine: canva, canvaDesignId, exportedAt`).
3. **Quota**: keep a local counter `~/.quire/canva-usage.json` `{ period, used,
   lastError }` incremented per successful premium call; show it in Engine settings
   ("Canva AI: 143 / ~200 this month — estimate, Canva does not expose the number").
   On an allowance error (Canva returns a 4xx with a quota/limit message — capture the
   exact code during implementation and add it to the error taxonomy in `errors.mjs`)
   or when `used ≥ premiumUses`, mark the engine `exhausted-until <reset>` and **fall
   back to Comfy in the same job**. Emit `job:progress` with
   `{ notice: "Canva AI allowance used up — routed to ComfyUI" }`; the gate card shows
   the notice; the sidecar records `fallbackFrom: "canva"`. If Comfy is not installed,
   the job fails with the existing degraded-mode hint (02) and the install action.
4. Tier awareness: `providers` → Connections screen (20 §3) reads the plan from the
   OAuth profile where available; otherwise the user picks Free / Pro / Business in the
   Canva connection card and the quota table follows.

### 3.3 Where Canva images are good enough
Canva's generator (Leonardo Phoenix-class) is fine for spot illustration, textures,
typographic experiments and quick candidates; weaker than Comfy + a technique LoRA for
a *consistent* world, and unable to take reference images. Default policy in
`artPolicy`: **magazine** may use Canva for `spot`, `ornament`, `texture`, `photo`
(stock via library instead of generation, §5); **storybook/book** default to Comfy for
every recurring character and to Canva only for tailpieces and ornaments. The user can
override per surface.

## 4. B — Canva AI Studio inside Affinity (cutouts without shipping rembg)

The Affinity build already runs scripts through the Affinity MCP. Affinity with a Pro
account exposes Remove Background / Select Subject / Generative Fill / Expand / Edit /
Generate Vector in the Canva AI Studio. Two ways to use them:

1. **Scripted, if exposed.** During 07 task 2 (`T.cutout`), probe the Affinity
   scripting surface for the AI Studio operations. If callable, `T.cutout()` prefers
   `removeBackground()` on the placed image and falls back to a pre-cut alpha PNG from
   the `rembg-birefnet` workflow (09 §2). Same for `generativeExpand()` when a
   `full-bleed` treatment is short of bleed by < 15 %.
2. **Manual, always available.** The Beauty gate's *tweak* verdict offers "open in
   Affinity → AI Studio" for the selected image with instructions pre-filled; the
   result is re-imported by the build's `final/`-aware rescan (04 §6).

Both draw from the same 200-premium-use pool, so the quota counter (§3.2) is shared
across A and B. Comfy `rembg` remains the unlimited default; Canva's is the
higher-quality option when allowance remains.

## 5. C — Brand Kit and asset library as a mirror of the Design Kit

- On **Design Kit approval** (07 §1b) push the kit's palette, fonts (names only — Canva
  needs the files uploaded to Brand Kit manually on Pro), masthead PNG/SVG, ornaments
  and patterns to a Canva folder `Quire/<work>/kit@<version>` via `upload-asset-from-url`
  (through the shim's local file server) and create/update the Brand Kit palette. This
  makes every Canva derivative (§6) on-brand without re-explaining the world.
- **Stock photos**: for `surface: photo` briefs, before generating, search Canva's
  library through `generate-design`-with-stock or the editor (Pro includes the premium
  stock library, licensed for the user's own publications). Store the chosen element
  with `source.json { provider: "canva-stock", license: "canva-pro-content-license" }`
  next to Openverse/Commons candidates (09 §3). Never redistribute Canva stock inside a
  Taste Pack (18 §7).
- Reverse direction: a user who draws a pattern or gradient in Canva can "Send to
  Quire kit" from the extension (§6) or drop it in `final/` — it enters the kit as a
  route-C asset (07 §1).

## 6. D — Derivatives, and the Canva extension question

**Derivatives** (post-build, optional stage `build.derivatives`, magazine and books):
from the approved PDF + kit → `generate-design` with the cover image, title, and three
pull-facts → `resize-design` to Instagram carousel, LinkedIn post, 16:9 reveal,
newsletter header → export → `<work>/derivatives/`. The Brand Kit sync makes these
on-world. The `social-media-carousel` skill (already in the user's skill library) is
the authoring skill for carousel structure; Canva is the renderer.

**"Can we add a Canva extension?"** Two different things people mean:

| Meaning | How | Verdict |
|---|---|---|
| Quire *uses* Canva (Canva as a connector) | The remote MCP + Connect API above; one OAuth in the Connections screen | **Yes — this plan** |
| Quire *inside* Canva (an app in the Canva editor, "Quire for Canva") | Canva Apps SDK app: panel that lists the user's Quire works, inserts approved pages/images/kit assets into the current design, and sends Canva-made assets back to the kit. Needs a public backend (Quire is local-first) or a localhost bridge, and Canva app review for public listing | **Later** — after 07/08/09 primitives; ship as an unlisted app for the user's own account first |

The Apps SDK app is the sellable surface for "so many people use Canva": a Canva user
gets Quire's research-backed copy, per-section worlds and print-ready pages without
leaving Canva; Quire gets a distribution channel. It is a marketing/derivatives
surface, not the design engine — the print truth stays in Affinity + `final/`.

## 7. What Canva cannot do for Quire (so nobody plans on it)

- No pixel-precise layout API on Pro (autofill/brand templates are Enterprise; editing
  transactions are prompt-driven). Print pages are built in Affinity, period.
- No reference-image / identity conditioning → no Cast Sheet coherence via Canva.
- No seed → a "regenerate exactly" on a Canva image is impossible; the sidecar marks
  `reproducible: false` and the gallery's "remake" re-prompts instead.
- No API for remaining allowance → the local counter is an estimate; the fallback on
  error is the real safety net.
- Canva stock and Canva-generated assets have their own licence terms; keep them out
  of Taste Packs and LoRA training sets (09 §2C uses only Comfy-generated approved
  images).

## 8. UI (02 owns screens; listed here)

- **Connections**: a Canva card (connect via OAuth, plan picker if not detected,
  allowance estimate, "what Canva does here" in plain language).
- **Engine settings** (09 §6): per-surface default engine; the fallback rule shown as
  a sentence ("Canva first for spot art, ComfyUI when Canva runs out").
- **Gate/ job notices**: the fallback notice on the gate card and the job row.
- **Design Kit card** (07 §1b): "Mirrored to Canva Brand Kit ✓ / Sync" button.
- **Build gate**: "Make promo set" → derivatives folder card with thumbnails.

## 9. Order

| # | Task | Test |
|---|---|---|
| 1 | Canva OAuth in Connections; remote MCP registered in the shim MCP hub; `engines.json` with `canva` + `comfy` | `GET /v1/status` lists Canva connected, plan, estimate |
| 2 | `renderImage()` engine router with capability gating; Canva generate→export→sidecar | a `spot` brief renders through Canva; a `refs` brief goes to Comfy with reason |
| 3 | Quota counter + exhaustion error in taxonomy + same-job fallback + notice | forced quota error → image arrives from Comfy, sidecar `fallbackFrom: canva` |
| 4 | Affinity AI Studio probe; `T.cutout` prefers it when available | cutout page builds with either path |
| 5 | Design Kit → Canva folder + Brand Kit palette sync | kit approval creates the folder with assets |
| 6 | Canva stock search as a `photo` reference source with licence record | photo brief shows licensed candidates |
| 7 | `build.derivatives` stage + "Make promo set" (carousel skill) | approved issue → 3 exported derivatives |
| 8 | Unlisted Canva Apps SDK app "Quire for Canva" (insert approved assets; send-to-kit) | asset inserted into a Canva design from the panel |
