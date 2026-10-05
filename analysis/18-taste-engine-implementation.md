# 18 — Auto-Learning (Taste Engine): Implementation Spec

## Status (2026-09-11) — steps 3–8 built

Distill job (counted causes, then a model over notes and diffs), one `rules.jsonl`
with a scope on every rule (not one file per style/world/skill), Taste page with
"From your finals" first, accept → rule, injection into the book writer and the
ArtDirector, three-verdict trial flag, Taste Pack export/import (rules land as
proposals), clone taste. Not done: number rules written into a validator's constants;
rules for the short/script/storybook writers.

## Status (2026-09-07)

**Capture done (2026-09-11)** — `_taste/feedback.jsonl` (`studio/src/api/taste.ts`) from the
Verdict control, gate approve/reject, finding accept/ignore, page notes, the design desk
and Learn from final (`source: "final"`); `_taste/proposals.jsonl` with accept/ignore.
Not started: distill job, Taste tab, `rules.jsonl`, injection.
Its **inputs now exist**, which they did not when this was written: gate verdicts with
history (`pipeline.json`), finding verdicts (`findings.json` states), restyle records
(`audit-state.json`), and soon gallery verdicts (04) and fix diffs (19 §5b). Scopes to
support: `style` (05), `world` (08 §7), `audit` (19 §5), `setting` (22 §6), `skill`
(17). Capture (step 1) can start now as pure logging; distillation waits for the
gallery so image taste is included from day one.

> Consolidates and updates the learning loops from 04 (feedback sidecars),
> 05 (writing-style rules), 06 (design spec diffs), 08 (per-world rules) into ONE
> implementable system, now that 14 (pipeline/gates), 15 (context pack), 02 (UI),
> and 17 (skills/rules.jsonl) define the surfaces it plugs into.
> Existing footholds (verified): the app already has `StyleManager.tsx` (measure a
> prose sample → profile → hand to a book; mock 38-style) — that is the style-pack
> home; `GenreManager.tsx` + 16 genre packs in `core/genres/*.md` are the genre
> layer; the Taste screen is drawn as mock `20-taste.html` (queue + charcoal
> evidence, j/k/a/i) and reuses the audit pattern.

## Principle (unchanged)

Learning is: **capture → distill → approve → apply**. Nothing is ever silently
applied. Rules live next to the thing they tune (style pack, world, skill) as
`rules.jsonl`, and are injected via the context pack (15 §3).

## 1. Capture (free — falls out of the gates)

Every gate/verdict interaction (14) writes an event to
`<workspace>/_taste/feedback.jsonl`:

```json
{ "at": "...", "ref": {"type":"publication","id":"issue-042","unit":7},
  "surface": "content|design|image|build",
  "verdict": "keep|redo|tweak|reject|re-world",
  "note": "less clutter, warmer",
  "scope": { "world": "nordic-fieldnotes", "stylePack": "lyrical-noir",
             "skill": "quire-magazine-page", "archetype": "specimen-poster" },
  "diff": { … }   // when available, see §2
}
```

Sources, all existing once 14/02 land: chapter approve/reject+note, audit
accept/ignore per finding, image keep/redo/tweak, page 4-verdict buttons, spec
hand-edits. **No new UI is built for capture** — the gates are the capture UI.

Added 2026-09-10: every event may carry `cause` — an enum from the surface's
"what went wrong?" chips (04 §7) — and `source: "gate" | "gallery" | "final"`. The
`final` source is the **Learn-from-final** ingest (04 §6): text diffs, kit-asset
proposals read back from the user's `.afdesign`, PDF page diffs, dropped assets. Those
events are the highest-signal input the engine will ever get, so distillation weights
them ×3 and the Taste tab shows them under their own "From your finals" header. Kit
assets proposed from a final are not rules; they go straight to the kit library as
`draft` awaiting one approval (07 §1b).

### Diffs (the highest-signal capture)
- **Design**: when a user tweaks a page spec (or the rebuilt Affinity doc differs
  from spec), store `specBefore/specAfter` JSON diff.
- **Writing**: when a user edits chapter text post-approval (PUT chapter), store a
  compact diff (sentence-level).
- **Image**: lineage chain (04 sidecar `lineage.changeNote`) is already the diff.

## 2. Distill (a scheduled cheap-model job)

New executor `taste.distill` (queue job, profile `destyle`/cheap, runs on demand or
after each issue/book completes):

1. Read new feedback since last run, group by `scope` key (world, stylePack, skill).
2. Prompt: "here are N verdicts+notes+diffs for <scope>; propose at most 5 durable
   rules; each rule must be (a) one sentence, imperative, (b) checkable or
   prompt-injectable, (c) not already in the existing rules list (attached)."
3. Output contract: `{ scope, rules: [{ text, evidence: [feedbackIds], kind:
   "number|sentence" }] }` — `number` rules become validator constants (06),
   `sentence` rules become prompt lines.
4. Write to `_taste/proposals.jsonl`, state `pending`.

Guards: min 5 evidence events per rule; contradiction check against existing rules
(same distill prompt lists them); per-scope cap (rules.jsonl ≤ 40 lines, oldest
pruned only when superseded — proposals may include `supersedes: ruleId`).

## 3. Approve (one screen, reuses the audit pattern)

UI: **Taste tab** (per world / per style pack / global, 02 Wave 5) — proposals rendered
as `.finding` rows with evidence popover (the actual thumbnails/diffs that produced
the rule). Accept / Ignore / Edit-then-accept. Accepted → appended to the target's
`rules.jsonl` `{ id, text, kind, at, evidence }`; ignored → recorded so it is not
re-proposed.

API: `GET /api/v1/taste/proposals`, `POST /api/v1/taste/proposals/:id/{accept,
ignore}` (accept body may carry edited text), `GET /api/v1/taste/rules?scope=…`.

## 4. Apply (two paths, both existing surfaces)

1. **Prompt injection**: context pack (15 §3) already attaches top-N rules for the
   active scope — newest accepted rules take effect on the next unit with zero extra
   code.
2. **Validator constants**: `kind: number` rules (e.g. "whitespace ≥ 18%",
   "display ≤ 64pt on text-heavy pages") are written into the world spec's `math`
   block (08) by the accept handler, so `checkDesign` enforces them mechanically.

## 5. Updates to the earlier plans (deltas)

- 04: `feedback[]` in image sidecars stays, but the canonical stream is
  `_taste/feedback.jsonl`; sidecar entries reference stream ids (no double truth).
- 05: style-pack `rules.jsonl` format unified with this file (add `kind`, `evidence`).
- 06: the "spec-diff taste loop" is this system; delete its bespoke description —
  design diffs are just `surface:"design"` events.
- 08: world `rules.jsonl` idem; `breakBudget`/`math` become writable by rule-accept.
- 17: skill `rules.jsonl` idem — skills, styles, and worlds are the three rule homes,
  chosen by the proposal's `scope`.
- **New since discussion**: per-scope A/B guard — when a rule is accepted, the next 3
  units produced under that scope are tagged `ruleTrial: [id]`; if all 3 get `redo`
  verdicts, the Taste tab flags the rule for review (auto-learning that can also
  un-learn).

## 7. Taste Packs: export, import, sell (added 2026-09-07; sellable feature 11 #3)

Everything the engine learns is already a file. A **Taste Pack** is a signed zip of a
chosen subset with a manifest:

```json
// taste-pack.json
{ "id": "oyla-kids-science", "version": 2, "author": "…", "license": "…",
  "contains": {
    "styles":  ["voice/oyla-5yo", "blend/oyla-features"],      // 05 — guide + exemplars + profile
    "worlds":  ["riso-lab", "gouache-field-notes"],             // 08 — world.json + refs (no third-party images)
    "loras":   [{ "id": "riso-lab-v1", "base": "flux-schnell", "sha256": "…" }],  // 09 §2C — optional, large
    "audit":   ["kids-clarity"],                                // 19 — pack.json
    "rules":   "rules.jsonl",                                   // this file — the distilled taste
    "templates": ["mag-kids-a4-48p"],                           // 11 — print profile + flatplan archetype
    "cast":    []                                               // 08 §9 — only with the author's consent
  },
  "requires": { "quire": ">=0.2", "bases": ["flux-schnell"] } }
```

- **Export** from the Taste tab: pick scopes → preview what is included (never
  `feedback.jsonl`, never sources with unclear licences, never user manuscripts) → zip.
- **Import**: validates schema + hashes, installs into the library dirs under a
  namespaced id (`pack:oyla-kids-science/riso-lab`), shows a card in each library.
  Imported rules are **suggestions** until accepted — they enter the proposals queue,
  not `rules.jsonl`, so someone else's taste never silently overrides yours.
- **"Clone this issue's taste into a new issue"** is the local, one-click form of the
  same operation (export + import within the workspace), and the first thing to ship.
- **Marketplace** later: packs are files, so distribution can be a URL, a git repo, or
  a paid catalogue; the app only needs an "Install from URL" field and licence display.

## 6. Order

| # | Task | Gate |
|---|---|---|
| 1 | feedback.jsonl writer wired into all gate/verdict handlers (14) | every approve/reject appends an event |
| 2 | Diff capture (spec PUT, chapter PUT, sidecar lineage refs) | edits produce diff events |
| 3 | distill executor + proposals store | run on a seeded feedback file → sane proposals |
| 4 | Taste tab + accept/ignore API | accepted rule appears in rules.jsonl |
| 5 | Context-pack injection + validator-constant write-back | next unit's prompt contains the rule; number rule enforced by checkDesign |
| 6 | Rule-trial regression flag | forced-redo scenario flags the rule |
| 7 | **Taste Pack** manifest, export/import, "clone taste into new issue" (§7) — kits (07 §1b) included | export → import on a clean workspace reproduces the look and voice of a test issue |
| 8 | `cause` chips + `source: final` weighting; "From your finals" section in the Taste tab (with 04 §6–7) | a final with 10 shortened paragraphs yields a "shorter paragraphs" proposal ranked first |
| 9 | **Score-derived learning (§8)**: `score` events, failure fingerprints → lint-rule proposals, weight calibration per scope | 3 pages failing `I/fill` in one world → one "cutout fill 0.6–0.8" proposal; accepting it makes spec-lint reject the 4th before render |

## 8. Learning from the Page Score (added 2026-09-22; design-skill §12b)

Every `scorePage` / `spec-lint` / `asset-check` pass appends a `surface: "score"`
event: `{page, checkpoint, score, dims{G..R}, cause, subMetric, value, fingerprint,
fixApplied, outcome}`. Human page verdicts carry a `cause` chip drawn from the **same
seven dimension names**, so one stream holds both.

Three distillations run over it:

1. **Fingerprint → lint rule.** `fingerprint = (dim, subMetric, archetype, slotRole,
   type)`. ≥ 3 failures under one scope (world / type / audience) → a proposal whose
   body is a spec-time constraint ("in `riso-lab`, `dense` archetype: dominant ≥
   0.50"). Accepted → written to that scope's `math` block → `checkDesign` /
   spec-lint enforces it *before* any render or Affinity call. This is the "never the
   same mistake" mechanism: the failure becomes unbuildable, not just detectable.
2. **Disagreement → calibration.** Human keeps a page scoring < 80, or redoes one
   scoring > 90 → per-scope weight nudge toward the human's implied ranking (±0.02
   per event, floor 0.05, renormalised; thresholds fixed). Stored as `scoreWeights`
   in the world/type spec; shown in the Taste tab as "how you weigh things".
3. **Cause → craft.** Human `cause: I` on a page the machine scored I ≥ 85 is a gap
   in the I metrics, not the page — surfaced as "the score missed this" so the
   metric set itself can be extended (a proposal against the skill, `scope: skill`).

Rule-trial guard (§5) applies: an accepted lint rule that produces 3 `redo`s is
flagged for un-learning. Score events from finals (04 §6) weigh ×3 like other
final-derived evidence.
