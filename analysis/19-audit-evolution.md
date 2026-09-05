# 19 — Audit Evolution: Per-Type Improvements + Continuous Learning

> Grounded in source (verified 2026-08-31), `vendor/studio/packages/core/src`:
> `pipeline/chapter-review-cycle.ts` (assess→revise loop, PASS_SCORE_THRESHOLD=85,
> maxReviewIterations default **1**), `agents/continuity.ts` (ContinuityAuditor, 37
> dimensions in DIMENSION_LABELS, JSON output w/ severity+repairScope, score
> calibration in-prompt), deterministic passes (`agents/ai-tells.ts` hedge/transition
> word lists, `agents/post-write-validator.ts` marker lists, `agents/sensitive-words.ts`,
> length bands), `agents/reviser.ts` (patch-only / rewrite-only / allow-full),
> `pipeline/publication-audit.ts` (length bands + ai-tells + repetition; findings
> REPORTED, not enforced), `publication-runner.ts` checkPlan/checkDesign (hard rules),
> `pipeline/detection-runner.ts` + `agents/detector.ts` (external GPTZero/Originality,
> threshold 0.5, autoRewrite=false), `pipeline/fact-check.ts` (extract≤12 claims →
> search → verify), `pipeline/findings.ts` (severity normalization),
> `agents/rules-reader.ts` (genre packs select `auditDimensions`; `book_rules.md`
> supplies prohibitions, fatigueWordsOverride, additionalAuditDimensions).

## The key insight

**The extensibility mechanism already exists but is buried**: genre packs choose which
of the 37 dimensions run; `book_rules.md` can add dimensions and override fatigue
words. Nobody can see or edit this from the UI, nothing updates it from feedback, and
the deterministic lists (ai-tells, post-write markers) are hardcoded in TS. The plan:
promote audit criteria to **versioned data ("audit packs")**, per type, editable in
UI, and fed by the taste engine (18). Audit becomes the fourth learning surface
alongside style, worlds, skills.

## 1. Audit pack: the data model

```
workspace/audit/
  packs/<id>/pack.json          user + builtin (builtin ships in core/audit-packs/)
  overrides/<productionRef>.json   per-book/issue opt-ins
```

```json
// pack.json
{
  "id": "human-warmth-v2", "version": 3,
  "appliesTo": ["book", "short", "translation"],       // production types
  "extends": "core-37",                                 // builtin base
  "dimensions": {
    "enable": [1,4,7,"hook-debt","lexical-fatigue"],
    "disable": ["title-fatigue"],
    "custom": [{ "id": "warmth", "label": "Human warmth",
                 "instruction": "Flag passages that state emotion instead of evoking it; flag zero sensory detail in a scene > 300 words." }]
  },
  "deterministic": {
    "fatigueWords": { "add": ["nestled","testament","tapestry"], "remove": [] },
    "hedgeWords": { "add": [] },
    "markers": { "add": [], "remove": ["COLLECTIVE_SHOCK"] },
    "paragraph": { "maxChars": 500 }
  },
  "scoring": { "passThreshold": 85, "maxIterations": 2 },
  "rules": []                                            // taste-engine accretions (18)
}
```

- `custom` dimensions are prompt-injectable one-liners — this is exactly how a user
  request like *"I want more human-like writing"* or *"different flavour"* becomes an
  auditable criterion: it's a sentence + optional deterministic list, in a pack.
- Resolution order per unit: builtin base → type defaults → genre pack (existing) →
  audit pack(s) selected on the book/issue → `book_rules.md` additions → per-unit
  override. One resolver function replaces today's scattered merges in
  `continuity.ts` lines 293–359.

## 2. Engine changes (make criteria injectable)

| # | Change | File |
|---|---|---|
| E1 | Extract the 37 DIMENSION_LABELS + 30 STORY_DIMENSIONS into `core/audit-packs/core-37.json` (builtin pack); loader with validation (mirror skills/genres loaders) | `agents/continuity.ts`, `pipeline/story-audit.ts` |
| E2 | Parameterize deterministic lists: `ai-tells.ts`, `post-write-validator.ts`, `sensitive-words.ts` accept `{add,remove}` deltas from the resolved pack instead of module constants | those files |
| E3 | `chapter-review-cycle.ts`: read `scoring.passThreshold`/`maxIterations` from pack (today hardcoded 85 / 1 — **raise default iterations to 2**; 1 means a failed revise is never re-checked against new issues) | chapter-review-cycle.ts |
| E4 | Auditor prompt: render enabled dimensions + custom instructions from the pack; keep the JSON output contract and score calibration | continuity.ts |
| E5 | **Findings with offsets**: extend AuditIssue with `{para, start?, end?, quote}` so the UI can highlight passages (the mock's audit screen and Accept-fix depend on it) | continuity.ts, findings.ts, reviser.ts |
| E6 | Reviser receives the pack too (so a `warmth` fix knows the instruction that raised it) | reviser.ts |

## 3. Per-type audit: current state → target

| Type | Today (verified) | Improvements |
|---|---|---|
| **Book** | Full loop: 37-dim LLM audit + deterministic + length; reviser; state validation | Packs (above); iterations=2; offset findings; destyle integration (see §5) |
| **Short** | Multi-stage in `agents/short-fiction.ts` (outline→draft→review→package) with its own review | Route its review through the same resolver + packs; add pacing dimension tuned for shorts (single-sitting arc) |
| **Script** | Audited as prose via story audit | Add script pack: format validation (deterministic: scene headings, dialogue attribution), read-time-per-page, character-voice distinctness dimension |
| **Storyboard** | Prose audit only | Panel pack: shot-variety dimension (no 3 consecutive identical framings), caption length bands, panel↔beat coverage check (deterministic against plan) |
| **Translation** | Prose audit | Translation pack: glossary adherence (deterministic against the existing glossary), register-consistency dimension, untranslated-fragment detector |
| **Publication (magazine)** | publication-audit (length, ai-tells, repetition — REPORT only) + checkPlan/checkDesign (enforced) | (a) Make severity of publication findings configurable per pack — today nothing blocks; a `blocking: ["length-band"]` list lets copy gates actually gate. (b) Add per-section-voice dimension (each section keeps its register). (c) checkDesign gains pack-supplied `math` rules from worlds (08/18). |
| **Interactive film** | Graph defects via StoryGraphTree (unreachable nodes, dead choices) | Keep deterministic graph audit; add branch-tone dimension (choices meaningfully differ) via pack |
| **Play** | none (correct — live state) | none |

## 4. UI (extends mock 08-audit; new pack editor)

1. **Audit screen** (02 Wave 1) gains a *pack indicator* + "why this finding" — every
   finding shows its source (dimension id / pack / rule) so audits stop feeling
   arbitrary. Offset highlights via E5.
2. **Audit pack editor** (new, Tools rail; reuses GenreManager's two-column pattern):
   dimensions as check rows (enable/disable), custom dimensions as chips with an
   instruction editor, deterministic word lists as chips, thresholds as fields.
   "Try against chapter N" button runs a one-off audit preview — *edit criteria, see
   findings change* is the user-friendliness the current system lacks.
3. **Book/issue settings**: pick packs (multi-select), same place genre is chosen.
4. Findings queue keeps j/k/a/i; per-finding actions Accept-fix / Ignore / **"Never
   flag this again"** — the third writes a suppression to the pack draft (see §5).

## 5. Continuous learning (the "audit needs updates once in a while")

Audit joins the taste engine (18) as a scope:

1. **Capture** (free): every finding verdict is logged — accepted fixes, ignores, and
   "never again" suppressions, with dimension + pack + type. User free-text asks in
   chat ("more human-like", "less melodrama") that lead to revisions are captured as
   `surface:"audit-intent"` events.
2. **Distill** (18's job, audit scope): proposes pack deltas —
   - a dimension ignored >80% over ≥10 findings → propose disable;
   - repeated accepted fixes sharing a pattern → propose a custom dimension or
     fatigue-word additions;
   - an audit-intent phrase → propose a custom dimension draft (e.g. warmth above).
3. **Approve**: proposals appear in the Taste tab (mock 20) with evidence; accepting
   bumps `pack.version` and appends to `pack.rules`.
4. **Benchmark guard** (audit-specific, new): keep `workspace/audit/bench/` — 6–10
   frozen passages per type with expected findings (seeded from real accepted/ignored
   history). Every pack version change runs the bench; a version that stops catching
   known-bad or starts flagging known-good is warned before activation. This is the
   "market standard" anchor: bench passages can include public exemplars the user
   pastes in ("audit against THIS quality").
5. **De-AI connection**: detection-runner needs an external API today; fold the local
   deterministic tells (ai-tells + post-write) into a pack-tunable "slop score" so
   users without a GPTZero key still get a meaningful humanity check, and the destyle
   stage (14 §5) consumes the same pack.

## 6. Implementation order

| # | Task | Test |
|---|---|---|
| 1 | Pack schema + loader + builtin `core-37` extraction (E1) | book audit unchanged w/ default pack |
| 2 | Deterministic deltas + thresholds from pack (E2, E3) | pack with added fatigue word flags it |
| 3 | Custom dimensions into prompt (E4) + offsets (E5, E6) | "warmth" pack produces located findings |
| 4 | Resolver + per-type default packs (script/storyboard/translation/publication §3) | each type audits with its pack |
| 5 | Pack editor UI + pack pickers + finding source display | edit→preview loop works |
| 6 | Verdict capture + audit scope in 18 + suppressions | ignored-dimension proposal appears |
| 7 | Bench guard | version bump runs bench, reports drift |
