# Quire — Architecture Overview & Master Plan

> First analysis 2026-08-28. **Re-baselined 2026-09-07** against Quire 0.1.26
> (`Quire-Dev` + `vendor/studio` @ `8b564ff2`, ~28k lines added since the plans were
> written). Source of truth for what exists: `Quire-Dev/ARCHITECTURE.md`.

## What Quire is today

```
quire.exe (Tauri shell)
  ├── cli-shim (Node, 8787 prod / 8788 dev)
  │     • OpenAI-compatible API over agent CLIs (claude / codex / devin / antigravity)
  │     • error taxonomy · usage envelope · /events SSE · preflight
  │     • ComfyUI adapter + installer · Affinity bridge · MCP hub
  └── Studio engine (Hono + React, 4567 / 4568) — vendor/studio, branch quire
        • 9 production types, one pipeline: CONTENT → gate → DESIGN → gate → BUILD → gate
        • pipeline.json state machine (approve / reject / withdraw, append-only history)
        • serial job queue + SSE · executors (artplan → Comfy → review; layout/export)
        • audit with located findings + memory · voice library + restyle
        • 26-agent roster, per-agent model pins · pi-ai for direct API providers
  Workspace: ~/Quire (books/, shorts/, storybooks/, Magazine/, styles/, .quire/)
```

The idea is unchanged and still unusual: the user's existing agent subscriptions as the
LLM engine of a publishing studio, local image generation, real print layout.

## Where the build stands (verified 2026-09-07)

| Area | Built | Not yet |
|---|---|---|
| Pipeline (14) | **one spine for every type with declared skips + auto-signed empty gates, magazine mirrored onto it, magazine `design` stage finally called, per-unit cancel** (2026-09-17); stage graph per type, gates reversible, jobs, resume, storybook type, withdraw→cancel, audit/destyle stages for short/script/storyboard/translation/film, Typst reflow build + print folder, RunPage on pipeline.json | SQLite index, bilingual imposition |
| Audit (19) | offsets, memory, settle-with-fix, restyle awareness, **rewrite one finding**, iterations=2, **reader map**, **packs (catalogues, resolver, per-type, editor page, preview), beat scope, batch rewrite, never-flag-again, bench guard, local slop score** (2026-09-11) | gates reading `blocking`; bench seeding proven live |
| Style (05) | voice library, **fingerprint v2 + distance**, **exemplars**, **chunked verified restyle**, **blends ≤5**, **style-drift dimension** (2026-09-11) | style packs, per-facet guide merge |
| Design system (08) | DesignSpec, **ArtPolicy per type**, worlds (per work + per section), `composeImagePrompt()`, **ArtDirector briefs**, **World card**, **Cast Sheet** (prompt-only) (2026-09-11) | world library, golden rules, reference conditioning |
| Images (09) | Comfy adapter, one workflow, **recipe beside every image**, **gallery**, **treatments + post-process**, **seeded roll**, **engine router + Canva with quota fallback** (2026-09-11) | model rembg, LoRA base, refs, inpaint, fal/Replicate |
| Models/harness (20) | CLIs as endpoints, pins, errors, usage | **pi as seam**, Connections screen, capability routing |
| Setting/research (22) | **Setting Bible**, `content.research` on every type, **Setting Card**, **deterministic anachronism pass**, ask-once card, library, **Series** (2026-09-11) | character `speech` per role, taste scope `setting` |
| Affinity (07) | page-shaped magazine build, `tk.js` motifs, **Design Kit** (manifest, library, Kit card, capture on first use), `T.cutout` stepped wrap, pictures staged (2026-09-11) | template .afdesign, symbols, `T.fx`/`T.text(style)`, reflow build |
| Canva (23) | Affinity MCP bridge (Canva-owned), **engine + quota fallback + connection card** (2026-09-11) | AI Studio hook, Brand Kit mirror, derivatives, Apps SDK app |
| Gallery (04) | **Gallery screen + asset routes, recipe beside every image, pictures on the audit screen**, **`<Verdict>` with cause chips**, **`my-final/` + Learn from final** (text + PDF), treatment switch (2026-09-11) | `.afdesign` read-back, global library |
| Taste (18) | capture; proposals from finals; **distill (counted causes + model), rules.jsonl, Taste page, injection into writer + ArtDirector, 3-verdict trial, Taste Packs, clone taste** (2026-09-11) | number rules enforced by a validator; rules in non-book writers |
| Magazine (13) | **writing bar + readability, surface mix, beauty pre-screen, personal sources (notes + Zotero), recurring issues, design + illustration skills** (2026-09-11) | section board approval, auto-redesign loop |
| Print (07 §Print) | **print.json, spine/cover, EAN-13, preflight, upload folder + checklist** (2026-09-11) | ordering through an API (Lulu needs public URLs) |
| Skills (17) | **English frontmatter + versions on all 17, skills lint in the suite, deslop/review output contracts, style-block awareness, `quire-magazine-page`, `quire-research-setting`, `GET /skills/:id`, English role folders with a read-shim, `voiceSkill` preference order** (2026-09-11) | zh/en prompt extraction (deliberately deferred — it is language support, not leakage); §4 tool envelope → 20 |
| Reader (10) · macOS (11) | — | not started |

## File map (consolidated; superseded files removed)

| File | Topic | Kind |
|---|---|---|
| `01-what-works.md` | Subsystem status at first analysis (historical) | analysis |
| `02-ui-improvement.md` | Vermilion implementation + **the list of screens the other plans need** | impl |
| `04-organisation.md` | Workspace, sidecars, **Gallery** (approve/redesign/delete) | impl |
| `05-writing-styles.md` | **Style analyzer fidelity, verified restyle, multi-voice blends** | impl |
| `07-affinity.md` | Affinity build: cutout grammar, reflow, components | impl |
| `08-design-system.md` | **ArtPolicy per type, worlds, one prompt composer, golden rules** (absorbs 06) | impl |
| `09-image-generation.md` | **Treatments, seeded variety, LoRA/base-model answer, real photos, engines** | impl |
| `10-reader.md` | Reader UI | concept |
| `11-future-platforms.md` | macOS, mobile, **the seven sellable features** (→ 07, 08, 13, 18, 19, 22) | concept + index |
| `13-magazine-master-plan.md` | Magazine-specific: section casting, pacing, beauty gate | impl |
| `14-pipeline-fix-implementation.md` | Orchestrator — status + remaining (absorbs 12) | impl |
| `17-skills-and-tools.md` | Skill descriptions fix, new skills | impl |
| `18-taste-engine-implementation.md` | Capture→distill→approve→apply | impl |
| `19-audit-evolution.md` | **Targeted rewrite**, packs, new audit kinds, learning | impl |
| `20-harness-and-models.md` | **pi as provider seam, zero-touch Connections, capability routing** (absorbs 15) | impl |
| `21-multi-agent-workflow.md` | Roster, coordination (routing → 20, ArtDirector → 08) | impl |
| `22-setting-and-research.md` | **Time/place/culture as inputs: Setting Bible, research stage, cards** | impl (new) |
| `23-canva-integration.md` | **Canva Pro: image engine with quota fallback to Comfy, AI Studio in Affinity, Brand Kit mirror, derivatives, extension** | impl (new 2026-09-10) |
| `24-centralisation.md` | **One registry, one screen, one pipeline — ties the 2026-10-05 revisions of 20 (Connections: API·CLI·Local), 02 (generic UI + motion) and 13 (brand, connection web, one pipeline)** | plan (new 2026-10-05) |
| `design-skill.md` | **Editorial Design skill** (portable, math-first: geometry, grid, type, colour, boxes, breaks, per-type mapping) → `quire-editorial-design` (17 §2 #6) | skill draft |
| `illustration-skill.md` | **Illustration skill** (portable: sensing from text, brief, per-type process, post-process, cast, reuse) → `quire-illustration` (17 §2 #6b); talks to design via slot/asset | skill draft |
| `workflow.md` | Master workflow diagram (Mermaid) | diagram |

Removed 2026-09-07: `03` (into 14/20), `06` (into 08), `12` (implemented — registry
stage graph), `15` (into 20), old `20`.

Updated 2026-09-10 (illustration + Affinity focus): 07 gains the **Design Kit**
(Affinity vector/FX/gradient/pattern/type/slice assets, approved once, reused
forever) and skills-before-scripts; 08 ties world + kit into one approval and states
why magazine and book prompts differ; 09 adds the engine router (Canva ↔ Comfy) and the
per-type sensing rule; 13 adds the magazine writing bar and section-as-unit-of-
approval; 04 adds the `final/` folder + **Learn from final** and the `<Verdict>`
control with cause chips; 18 weights final-derived events; 02 lists the screens; 17
names the two skills.

## Implementation order (decided 2026-09-07)

Ordered by user value per unit of work, respecting dependencies:

| Phase | Plan | Work | Unblocks |
|---|---|---|---|
| 1 | 19 §5b, §5c | **Fix (rewrite) one finding** via Reviser; iterations=2; **boredom map** (11 #5) | the audit becomes a tool, not a report |
| 2 | 08 §1–3 + 09 §4 | `artPolicy` in registry; `composeImagePrompt()`; sidecar everywhere; populate worlds | no more photos in storybooks, no more naked prompts |
| 3 | 04 gallery | Gallery tab + asset routes + inline images | design gate has eyes; taste evidence begins |
| 3b | 04 §6–7 | `<Verdict>` with cause chips on every card; `final/` folder + **Learn from final** (text + PDF first) | feedback everywhere; the user's finished work feeds the next one |
| 4 | 09 §1, §3b + 07 (+§1b) + 08 §9 | treatments, rembg, masks, `T.cutout/wrap/vignette`, seeded roll; **Design Kit** + Kit card + capture-on-first-use; reference conditioning + **Cast Sheet** (11 #4) | end of full-bleed-everything; nothing drawn twice; same character on every page |
| 4b | 23 §3, 09 §5 | `engines.json`, `renderImage()` router, **Canva engine with quota fallback to Comfy**, Canva connection card | GPU-less users get art day one; Pro allowance used, never blocking |
| 5 | 22 (+§8) | Setting Bible, research stage on all types, cards, anachronism pass, ask-once card; **Series** (11 #2) | authenticity of writing; memory across books |
| 6 | 05 | fingerprint v2, exemplars, chunked verified restyle, blends, style-drift | authenticity of voice |
| 7 | 20 | providers.json; pi bump; native Anthropic/OpenAI behind "connect via"; Connections screen; capability presets | zero-touch setup |
| 8 | 14 remainder + 07 §Print | withdraw→cancel, RunPage on pipeline.json, content executors for the 4 types, reflow build; **print profile, spine/cover, preflight, Order-a-copy** (11 #1) | every type end-to-end, to a bound book |
| 9 | 09 §2 + 13 (+§4b, §Sources) + design-skill | LoRA-capable base + technique pack; magazine section+kit casting, **writing bar + readability pack**, `quire-editorial-design` + `quire-illustration` skills, surface mix, beauty gate; **personal magazine** connectors (11 #6) | magazine quality; recurring use |
| 10 | 18 (+§7) | taste engine over all five scopes incl. final-derived events; **Taste Packs** export/import (11 #3) | the product improves itself, and its taste travels |
| 11 | 10, 11, 07 §Print bilingual, 23 §6 | reader, macOS, **bilingual facing-page edition** (11 #7), Canva derivatives + "Quire for Canva" app | reach |

02 (UI) is not a phase; each phase ships its screens from the table in 02. The seven
sellable features are defined in **11 §Sellable** and specified in the plans named there.

## Two principles, unchanged

1. **Everything is a spec file + a registry** — now including `artPolicy`, worlds,
   `providers.json`, settings, LoRAs, audit packs, blends.
2. **Research in, slop out** — put authentic material (setting, voice exemplars,
   design world) *into* the prompt rather than scrubbing generic output afterwards.
