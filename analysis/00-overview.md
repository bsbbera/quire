# Quire — Execution Plan

> Re-planned **2026-10-08** (plan 26). Re-baselined **2026-10-06** against the code (`vendor/studio` @ `74b8f3fd`,
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
states (02). Magazine: brand book, connection web, signature pages,
writing bar, surface mix, personal sources (Markdown + Zotero), recurring (13).

## Closed phases 1–6 (2026-10-06 → 10-07)

1. **Magazine on the shared pipeline:** Indigo ran research → audit on `runStage`.
   Its copy gate is held by p14 `readability/over-cap`, yours to rewrite or sign.
2. **Models:**
   - pi 1.0.4, Connect via (API · CLI · ACP), presets, telemetry and budget pause,
     per-production pins.
   - Yours: Claude Code's sign-in has expired.
3. **Gates that enforce:** blocking categories, reader personas, golden rules,
   number rules from taste.
4. **One page score:** place → render → score → mend by cause (≤ 2).
5. **Pages built from the spec:** block vocabulary, `T.drawn`, font preflight;
   the PETRICHOR fixture scores 99.
6. **Approval UI:**
   - section board (keep/lock), beauty gate (four verdicts, score card),
     taste per world
   - **built and verified, not committed**
   - also uncommitted: the `design-rules.ts` fix ({rule, why} breaks crashed the
     design stage).

**Folio test, 2026-10-08:** Quire's first issue end to end (research → design →
Affinity), using the user publication type `Output/publications/folio.json` and
drawn vectors only.
- **Result:** 1 of 5 pages passed.
- **Faults:** design notes printed on the page, the standfirst over the body,
  text that doesn't fit its frame, grey covers and too much accent, the slug
  wordmark.
- **Underneath:** one hard-coded look, and coordinates written by the model.

That led to plan 26.

## The plan from here: 26 — one house, many worlds

The brand is a grammar (house book), the art changes per subject (section world),
the model chooses and code computes, and design is decided before pictures. Detail
and "Done when" for each phase: `26-design-engine.md`.

| Phase | What | Gate it adds |
|---|---|---|
| 7 | House book + style library (absorbs the old world/kit library) | House approved once |
| 8 | Layout engine: grid systems, pattern library, fitting solver, vector kit, the five folio faults | — |
| 9 | Design signals from writing + art direction with 2–3 world options | Gate 1: choose a world |
| 10 | Wireframe proof: Affinity build with placeholders, scored | Gate 2: approve spreads |
| 11 | Pictures driven by the design (09; GPU safety first) | Regenerate art at the beauty gate |
| 12 | Learning loop: preferences, exemplars, repetition, read back your Affinity edits | — |
| 13 | Leftovers (below) | — |

## Phase 13 — Leftovers

- 05: a live "Sample" in the mixer; a merged guide per facet.
- 22: `speech` per character in roles; Setting library screen; Series shelf on Home;
  taste scope `setting`.
- 19: image ↔ text coherence check; a repetition scan across the whole work.
- 21: ImageSmith / DesignAuditor / AffinityBuilder as named agents.
- 07: template `.afdesign`; node-side text measurement.
- 02:
  - delete `studio-patch/patch.js` and `cli-shim/ui.html`
  - drop `lucide-react` and `motion` from `package.json`
  - a desktop notification when a gate opens
  - banners for degraded mode
  - gate cards say what happens next

## Deliberately not doing

- SQLite index (14) — `allRuns()` walks the disk; add only when Home is slow.
- zh prompt extraction (17 §1.2) — language support, not leakage.
- Tool envelope (17 §4) — only if Phase 2 step 5 (pi) needs it.
- Affinity reflow script (14, 07) — Typst covers reflow.

## File map

| File | Topic |
|---|---|
| `02-ui-improvement.md` | Generic UI, components, motion, screens list |
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
| `25-pages-from-the-spec.md` | Block vocabulary, spec → Affinity (built) |
| `26-design-engine.md` | **The plan:** house book, worlds, layout engine, gates, learning |
| `design-skill.md` · `illustration-skill.md` | Skill drafts (shipped as skills) |
| `debt.md` | Parked work and its return condition |
| `workflow.md` | Workflow diagram |
| `10`, `11`, `23` | Parked |

## Two principles, unchanged

1. **Everything is a spec file + a registry.**
2. **Research in, slop out** — authentic material goes into the prompt rather
   than scrubbing generic output afterwards.
