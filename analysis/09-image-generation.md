# 09 — Image Generation: ComfyUI, Alternatives, and In-App UI

## Where you stand

ComfyUI integration is the best-engineered part of the shim: portable-install discovery,
GPU tiering, resumable 11 GB installer, and — crucially — the **templated workflow
registry** (`workflows/*.json`, builtin + user, validated, placeholder-filled). Only one
builtin exists (Z-Image Turbo: unet + Qwen text encoder + VAE).

## Other engines — what's worth integrating

### Offline (local)

| Engine | Verdict |
|---|---|
| **More Comfy workflows** ✅ first move | Not a new engine — new JSON files. Add: FLUX.1-schnell (quality), SDXL+LoRA (style packs), Qwen-Image / SD3.5 (text-in-image for mastheads), an **inpaint workflow** (fix a region, keep the rest — essential for "tweak" feedback), an **IPAdapter/style-reference workflow** (conditions on world reference images, 08 — the real "same taste" mechanism), and a **rembg/BiRefNet post-process** for cutouts (06). |
| Stable Diffusion WebUI (A1111/Forge) | Redundant with Comfy; skip. |
| SD.Next / InvokeAI | Skip — same models, another install. |
| **Apple MLX / CoreML SD** | Only relevant for the macOS port (11); on Apple Silicon, `mflux` (FLUX on MLX) is the realistic local option. Design the engine interface now so this slots in. |

**Conclusion: don't add a second local engine. Add workflows.** Comfy is the local
abstraction already.

### API (online) — for users without a GPU

| Provider | Access | Verdict |
|---|---|---|
| **Midjourney** | No official API. Unofficial relays/Discord bots violate ToS — do **not** build a product on them. But: user-subscribed MJ **could** be reached via an MCP server the *user* installs at their own risk; because the shim already has an MCP hub, that costs you nothing — document it, don't ship it. |
| **fal.ai / Replicate** ✅ | One HTTP API, many models (FLUX, SDXL, recraft, ideogram), pay-per-image, trivial to adapt. Best first API engine. |
| OpenAI gpt-image-1, Gemini Imagen | Good quality, easy; already half-supported — Studio has **cover provider** config + secrets (`/api/v1/cover/*`). Unify: covers shouldn't have their own separate provider system. |
| Recraft / Ideogram | Excellent for text-in-image & vector-ish output — useful for mastheads/infographics. Reachable via fal/replicate anyway. |

### The architecture that keeps this sane: one engine interface

```js
// engine = { id, kind: "local"|"api", capabilities: ["txt2img","inpaint","style-ref","transparent"] }
generate(recipe) -> { image, sidecar }        // recipe as defined in 04
```

- `comfy` engine (exists) + `fal` engine (~150 lines) + `openai`/`gemini` (covers merge).
- The **recipe sidecar (04) is engine-agnostic**: it records engine + workflow/model +
  prompt + seed + world/stylePack. "Remake with same taste" = same recipe, new seed;
  "tweak" = inpaint recipe with parent lineage.
- Per-issue routing: art stage picks engine by capability + availability (no GPU → api;
  cutout needed → engine with `transparent` or rembg post-process).
- Organisation, feedback, and library are already defined in 04 and apply to *all*
  engines identically — that's the payoff of sidecars.

## Image kinds & treatments (fixes "everything is full-bleed")

Today every generated image is effectively a full-bleed rectangle. The ArtDirector
(21) must choose a **slot** and a **treatment** per brief, sensed from the content —
this taxonomy is part of the brief schema (14 §6) and each entry maps to a workflow +
post-process:

| Slot (where/why) | Treatment options |
|---|---|
| chapter/section opener | full-bleed, half-bleed (top/side), vignette |
| chapter ending / tailpiece | small spot, ornament, fade-out vignette |
| inline illustration | **cutout** (rembg alpha), soft-edge **watercolor bleed** (irregular painted edge, alpha), framed plate |
| margin / drop element | spot cutout, ornament |
| infographic / flow / timeline | vector-first (TK components, 07) or generated diagram style |
| texture / background wash | tile, low-opacity, transparent PNG |
| cover | full-bleed with type-safe area |

Rules for the ArtDirector:
- **Sense from content**: a chapter's mood/beat decides slot mix (an ending beat →
  tailpiece; a data passage → infographic; a character intro → cutout portrait).
  Books get FEW images (opener + tailpiece + occasional plate) — count per type set
  in the world/definition, not per page like magazines.
- **Anti-realism default**: every world's `imagePrompt` includes its technique
  (watercolor/riso/engraving/…); the negative prompt globally includes
  `photorealistic, photo, 3d render` unless the world explicitly opts into photo
  treatment. No naked prompts without a world fragment.
- **Transparency pipeline**: cutout/watercolor-bleed/ornament treatments generate on
  plain ground then rembg/BiRefNet → alpha PNG; sidecar records `treatment` so
  Affinity placement grammar (06) knows the rules.
- **Real reference images**: where factual accuracy matters (a real machine, map,
  animal), the brief may set `reference: "web"` — a search tool fetches 1–3 reference
  images into `art/refs/` (recorded with source URL; refs condition generation via
  IPAdapter, they are NOT placed in the layout unless license-clear and user-approved).

## Is an in-app UI needed? Yes — but a *review* UI, not a node editor

Do **not** rebuild ComfyUI's graph editor in-app (power users can open Comfy itself —
add an "Open in ComfyUI" link). What the app needs:

1. **Generation queue panel** — live jobs with progress (needs the shim SSE bus, 03),
   cancel, retry.
2. **Asset review grid** (04) — per page/chapter: candidates side-by-side, keep/redo/
   tweak, "3 variants" button, seed lock toggle, prompt visible & editable.
3. **Tweak mode** — image with brush-select region → inpaint recipe. This one screen
   converts image-gen from a slot machine into a tool.
4. **Engine settings page** — Comfy install/benchmark status (exists as endpoints, has
   no UI today — the 11 GB download is currently invisible!), API keys for fal/openai,
   default engine per capability.
5. **Workflow manager** — list/add/select workflows (endpoints exist: `GET/POST/PUT/
   DELETE /comfy/workflows`) — currently UI-less.

Items 4–5 are pure exposure of existing endpoints — build them first.

## Build order

1. Sidecar recipes in `comfy.generate` (from 04). — S
2. Engine settings + workflow manager UI (existing endpoints). — S
3. rembg post-process + inpaint + style-ref workflows. — M
4. fal.ai engine + cover-provider unification. — M
5. Review grid + tweak mode. — M
6. MLX engine (with macOS port). — L
