# Quire — Execution Plan

> Re-baselined **2026-10-06** against the code (`vendor/studio` @ `74b8f3fd`,
> `cli-shim`, `desktop`), every claim checked by reading source, not the plans.
> Source of truth for what exists: `Quire-Dev/ARCHITECTURE.md`. The numbered
> plan files hold the design detail; this file holds the **order**.
> Parked, not in this plan: 23 (Canva — see `debt.md`), 10 (Reader),
> 11 (macOS, mobile, extras).

## How to run it

- One phase at a time, on `dev`. Build every step of a phase, then **one live
  test pass** over the HTTP API (layout in a real browser). Not a test per step.
- A phase is done when its "Done when" line is true on the dev build, not when
  the code compiles.
- Update `ARCHITECTURE.md` and the plan file's status in the same change.

## Built (verified 2026-10-06)

Pipeline: one `SPINE` for every type, skips, three gates, withdraw → cancel,
per-unit cancel, resume, Typst reflow build, print profile + preflight (14, 07).
Audit: packs, resolver, editor, bench guard, slop score, reader map, rewrite one
finding / all accepted (19). Style: fingerprint v2, exemplars, chunked verified
restyle, blends, style drift (05). Design: ArtPolicy, worlds per work and per
section, ArtDirector, World card, Cast Sheet (prompt-only), Design Kit (08, 07).
Images: recipe beside every picture, gallery, Verdict + cause chips, treatments,
seeded roll, engine router (04, 09). Setting: bible, research on every type,
anachronism pass, Setting card, Series (22). Taste: capture, distill, rules,
trial, Taste Packs; rules reach book, short, script, storyboard, storybook and
magazine writers (18). Models: Connections (API · CLI · Local), validated-only
picker, keys in `~/.quire` (20). UI: guard at 0, tokens, `motion.css`, working
states (02, 03, 04-ease). Magazine: brand book, connection web, signature pages,
writing bar, surface mix, personal sources (Markdown + Zotero), recurring (13).

## Phase 1 — Magazine on the shared pipeline (13 C)

**Corrected 2026-10-06 (the first draft of this phase was wrong).** The code
already does steps 1 and 2: `publicationExecutor(ctx, stage)` in
`publication-runner.ts` holds `content.plan/write/factcheck/audit`,
`design.artplan/generate` and `build.export` as executors, and `run()` drives
them with the shared `runStage` against `pipeline.json` (ARCHITECTURE.md, "The
magazine runs on the shared pipeline"). The executors are resolved per run,
not registered at boot, on purpose: a magazine run carries its model call in
its context. `STAGE_ORDER` survives as the short names routes and the chat
tool use, not as a second engine. `publication.json` (content) beside
`pipeline.json` (run state) is two files by design.

Evidence it ran: `Magazine/indigo-…/pipeline.json` walked research, plan and
7 of 16 pages on 2026-10-05, then stopped on a provider quota (429), resumable.

What is left:

1. Finish that run (resume from `write`, stop at `audit`) and read the Run
   screen, rail card and gates for it.
2. Run it on to design and build only after you approve the copy gate; art
   uses the GPU, so Phase 6's safety work comes first.
3. `de-slop` (`runDeslop`) is the audit with a filter, not a stage; leave it.

Done when: one issue runs start → audit on the shared pipeline and the Run
screen, rail card and gates show it like any other type.

**Closed 2026-10-06.** Indigo ran research → plan → write (16/16) →
fact-check (57 claims) → audit on `runStage`; Run screen, rail card and gates
checked live. Audit tested on 9 of 16 pages (47 page findings, shown per page
on the Audit screen after the sync fix); finishing the other 7 is a resume, not
a test. Copy gate shows, warns "the audit has not finished", and is yours to
sign off. Fixes made on the way: plain model path for page/audit/revise,
per-page audit checkpoint + resume, Audit screen sync, plate label.

## Phase 2 — Models finished (20, 21, 02)

1. Shim reads `providers.json` (drop the in-code `AGENTS` list).
2. Model needs per agent + Best · Balanced · Frugal preset; resolver
   `pin → preset → needs`; Models page shows the reason per row (20 §4).
3. Telemetry `_telemetry/llm.jsonl` from the usage envelope → cost meter per run
   and budget guard (pause with a card at the ceiling).
4. Agent · model pill on run transcript blocks and job rows; model overrides per
   production in `pipeline.json` (21).
5. Last, optional: pi `@mariozechner` 0.67.1 → `@earendil-works` 0.85 and native
   Anthropic/OpenAI behind "connect via"; generic ACP adapter + session reuse.

Done when: a fresh workspace routes every agent without a pin, the run shows
who wrote what and what it cost, and a ceiling pauses a run.

## Phase 3 — Gates and validators that enforce (19, 18, 08)

1. Gates read the pack's `blocking` categories (copy gate actually gates).
2. Reader-map personas from the work's audience field.
3. Golden rules in `checkDesign` (dominant element, 60-30-10, whitespace,
   no three full-bleeds, declared breaks) — today only contrast + world validity.
4. `kind: number` taste rules written into the world/type `math` block on
   accept, so `checkDesign` enforces them.
5. Taste evidence popover shows the passage, not the finding title.

Done when: a blocking finding holds the content gate, and an accepted number
rule rejects a spec before render.

## Phase 4 — One scoring module (07, 09 §0.3b, 13, 18 §8, design-skill §12b)

1. Fix `renderPage` (still unverified) or rasterise the PDF page.
2. `measurePage(png, spec, assets)` → the seven dimensions; `scorePage` =
   measure + spec checks + cause routing → `pages/<nn>/score.json`.
3. Same module, three checkpoints: **spec-lint** (before build),
   **asset-check** (before staging), **page-score** (after render).
4. Cause-routed auto-redesign ≤ 2 passes; `surface: "score"` taste events.

Done when: a bad page is redesigned by its cause before the user sees it.

## Phase 5 — Magazine approval UI (13, 02)

1. Page bundles `pages/<nn>/{content,spec,art,render.png,score.json}`.
2. Section board = unit of approval (world, kit, opener, beats, copy proof;
   keep / re-world / lock).
3. Beauty-gate flipbook with the four verdicts and the score card.
4. Per-page re-run routes (rewrite / redesign / re-world / regenerate art).
5. Taste accumulated per world.

Done when: the six-step UX in 13 ("What the user actually does") works.

## Phase 6 — Pictures (09)

Keep refs at 1024 px and GPU temperature safety **first** — the laptop has hard
powered off twice on Qwen reference encoding.

1. GPU safety (pre-job cool-down, temp in recipe), workflow schema with
   `mode`, `refs[]`, `caps`, `license`.
2. `qwen-image-21.json`: generate → extract → edit; postprocess `alphaClean`,
   `cropToObject`, `invert`; gallery Edit / Extract.
3. `hooks[]` from writing; `graph.json` asset graph, decision table, DAG holds,
   budget.
4. Cast refs into the render seam (IPAdapter / native refs); inpaint + Tweak.
5. Engine settings + workflow/LoRA manager UI; upscale-2x.
6. Later: Openverse/Commons photo search, personal world LoRA.

Done when: generate → extract → edit → stage runs over `/image/render` and a
storybook protagonist stays the same across spreads.

## Phase 7 — Libraries (08, 07)

World library + Worlds page; Kit library; kit strip on the World card; kit verbs
`T.symbol / T.fill / T.fx / T.text(style)` (only `pattern` exists); template
`.afdesign`; font preflight; node-side text measurement.

## Phase 8 — Leftovers

- 05: live "Sample" in the mixer; per-facet merged guide.
- 22: `speech` per character in roles (only setting-wide exists); Setting
  library screen; Series shelf on Home; taste scope `setting`.
- 04: `.afdesign` read-back from `my-final/` (needs Affinity open).
- 19: image ↔ text coherence check; whole-work repetition scan.
- 21: ImageSmith / DesignAuditor / AffinityBuilder as named agents.
- 02: delete `studio-patch/patch.js`, `cli-shim/ui.html`; drop `lucide-react`
  and `motion` from `package.json`; desktop notification when a gate opens;
  degraded-mode banners; gate cards say what happens next.

## Deliberately not doing

- SQLite index (14) — `allRuns()` walks the disk; add only when Home is slow.
- zh prompt extraction (17 §1.2) — language support, not leakage.
- Tool envelope (17 §4) — only if Phase 2 step 5 needs it.
- Affinity reflow script (14, 07) — Typst covers reflow.

## File map

| File | Topic |
|---|---|
| `01-what-works.md` | Status at first analysis (history) |
| `02-ui-improvement.md` | Generic UI, components, motion, screens list |
| `03-ui-consistency-sweep.md` · `04-ease-of-use-and-motion.md` | Done sweeps (history) |
| `04-organisation.md` | Workspace, sidecars, Gallery, final folder, Verdict |
| `05-writing-styles.md` | Fingerprint, restyle, blends |
| `07-affinity.md` | Affinity build, Design Kit, Print |
| `08-design-system.md` | ArtPolicy, worlds, prompt composer, golden rules, Cast Sheet |
| `09-image-generation.md` | Treatments, Qwen asset graph, LoRAs, engines |
| `13-magazine-master-plan.md` | Brand, connection web, section board, beauty gate |
| `14-pipeline-fix-implementation.md` | Orchestrator, spine, gates, jobs |
| `17-skills-and-tools.md` | Skills |
| `18-taste-engine-implementation.md` | Capture → distill → approve → apply |
| `19-audit-evolution.md` | Packs, rewrite, reader map, bench |
| `20-harness-and-models.md` | Connections, providers.json, routing |
| `21-multi-agent-workflow.md` | Roster, per-agent models |
| `22-setting-and-research.md` | Setting Bible, research, Series |
| `24-centralisation.md` | One registry, one screen, one pipeline |
| `design-skill.md` · `illustration-skill.md` | Skill drafts (shipped as skills) |
| `debt.md` | Parked work and its return condition |
| `workflow.md` | Workflow diagram |
| `10`, `11`, `23` | Parked |

## Two principles, unchanged

1. **Everything is a spec file + a registry.**
2. **Research in, slop out** — authentic material goes into the prompt rather
   than scrubbing generic output afterwards.
