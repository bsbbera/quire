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

## Status (2026-09-11) — §1–5 built

Audit packs are data: `core/audit-packs/core-37.json` and `story-30.json` hold the
catalogues (extracted from the TS constants by script, and a test asserts 37 and 30);
`pipeline/audit-pack.ts` is the schema, loader and resolver (builtin base → type
default → packs chosen on the work → `book_rules` → per-work override). Per-type packs
ship for script, storyboard, translation, short and publication. Deterministic word
lists, the paragraph ceiling, `passThreshold` and `maxIterations` all come from the
pack (E2, E3 — `PASS_SCORE_THRESHOLD` is gone as a constant); custom dimensions reach
both auditor prompts (E4); the Reviser takes the whole group of a paragraph's findings
(E6). "Never flag this again" writes a category suppression into the work's own
override. The **Audit checks** page (Tools rail) edits all of it and previews a pack
against one file. `pipeline/audit-bench.ts` + `agents/slop-score.ts` cover §5.4 and
§5.5: saving a pack runs the bench and warns, and the de-AI pass falls back to a local
score when no detector key is set. §5b gains the `beat` scope and
`POST /audit/file/rewrite-accepted` (one call per paragraph, backwards).

Verified live on dev over HTTP: catalogues 37/30, five builtin packs, layering
(85→70, 2→3 rounds, merged custom checks, word list, paragraph cap) resolving through
type default → user pack → work override, and the bench warning fired on a pack that
silenced a check. Seeding the bench from settled findings returned 0 on this
workspace because all six findings are still open — that path is unit-tested only.

Not done: `blocking` categories are resolved and carried but no gate reads them yet;
audit-scope proposals reach the Taste page but their evidence popover still shows the
finding title rather than the passage.

## Status (2026-09-07)

| Piece | State | Where |
|---|---|---|
| Findings with `para/start/end/quote` offsets (E5) | **done** | `pipeline/findings.ts:35-67`, `locate()/locateQuote()` |
| Persistent findings queue + audit memory (settled findings stay settled; merge rules) | **done** | `.quire/findings.json`, `findings.ts:237-258`, `audit-state.ts` |
| Per-finding settle with fix at quote or paragraph scope | **done** | `POST /findings/:id/settle` → `applyFix/applyParagraph` (`findings.ts:277-351`) |
| Story audit: 30 dims + deterministic ai-tells/repetition, revise loop `MAX_ROUNDS=2` | done | `pipeline/story-audit.ts` |
| Book audit: 37 dims, mixed LLM + heuristic | done (unchanged) | `agents/continuity.ts`, `chapter-review-cycle.ts` |
| Restyle recorded as `rewritten` → stale verdicts | done | `audit-state.ts` |
| `maxReviewIterations` default | **2** (2026-09-11: `chapter-review-cycle.ts`, `project.ts` schema, `server.ts`, cli `utils.ts`) — E3 default done; pack-driven value still to come |
| Audit packs (E1, E2, E4, E6), resolver, editor, per-type packs | **not started** — dimensions are TS constants |
| Targeted rewrite of ONE finding | **done (2026-09-11)** — `POST /findings/:id/rewrite` → `rewriteFinding` (`findings-store.ts`), state `fixed` + `replaced`, `rewriteDrops` guard, `relocate` re-pins; "Rewrite it" on the audit screen. Not yet: `beat` scope, batch "rewrite all accepted", deterministic re-run on the paragraph, plan/setting context |
| Reader simulation / boredom map (§5c) | **done (2026-09-11)** — `reader-sim.ts`, `POST|GET /audit/reader`, cold paragraphs tinted on the page and filed as `reader/<persona>` notes; personas are fixed (2, +child for storybooks), not yet from the audience field |
| Learning loop / bench guard | not started (needs 18) |

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

## 5b. Targeted rewrite: "fix this finding" through the writer (new, 2026-09-07)

The settle route can *apply* a fix the model already proposed, but the auditor's
one-line `fix` is written blind and often flat. What is missing is a **rewrite of only
the flagged span, by the agent that writes, with the context that writing needs**:

```
POST /api/v1/findings/:id/rewrite   { scope?: "quote"|"paragraph"|"beat", note?: string }
```

1. **Assemble** — the finding (dimension, instruction from the pack, quote, suggestion),
   the target span at `scope` (`beat` = the paragraph plus the paragraphs before and
   after), the chapter plan/beat for that unit, the work's voice block (05 §3: rules +
   exemplars), the Setting Card (22), and the user's optional `note`.
2. **Reviser agent** (exists: `agents/reviser.ts`, patch-only mode) returns **only the
   replacement span** — same POV/tense, same events, length within ±30% of the span,
   no new facts. A cheap deterministic check verifies the span still contains every
   proper noun and quoted dialogue line of the original unless the finding was about
   them.
3. **Apply** through the existing `applyFix/applyParagraph` (offsets), record
   `rewritten`, re-run the deterministic passes on the paragraph only (ai-tells,
   anachronism, style-drift) and re-locate the remaining findings of that file so
   their offsets stay true.
4. **Finding state** gains `fixed` (distinct from `accepted`), with `fixedBy:
   "reviser" | "user" | "auditor-fix"` and the diff kept in `findings.json` — this is
   the taste-engine evidence (18) and the undo source.

Batch form: **"Rewrite all accepted in this file"** groups accepted findings by
paragraph, sends one Reviser call per paragraph with all of that paragraph's findings,
and writes once — fourteen findings become four calls and one file write. The whole
file is never re-generated, so a rewrite can no longer introduce new problems three
pages away.

UI: every finding row gets **Fix (rewrite)** beside Accept-fix / Ignore; hovering shows
the span it will touch; the result appears inline as a diff with keep / undo. The
`/audit/file/revise` note box stays for whole-file direction ("tighten the middle"),
labelled as such.

## 5c. New audit kinds worth adding

| Kind | Mechanism | Type |
|---|---|---|
| **Reader simulation / boredom map** (sellable, 11 #5) | 2–3 persona agents built from the work's audience field (age, genre habit, patience) read the unit *sequentially* and emit `{para, attention: 0–1, reason, wouldStopHere: bool}` per paragraph; aggregated into a **heat strip** beside the manuscript in the audit screen (dark = attention fell), with the persona's quote on hover and "Fix (rewrite)" on the cold spans. Storybooks add the child-question persona ("what would a 7-year-old ask here?") whose questions become optional margin notes for the parent. `severity: note`, never blocking; findings are `reader/<persona>` so the taste engine learns which persona the user trusts | all prose |
| **Setting / anachronism** (22) | deterministic lexicon pass + dim 12 | pinned settings |
| **Style drift** (05 §5) | fingerprint distance vs target, gaps as finding text | voiced works |
| **Image ↔ text coherence** | vision-capable model checks each placed image against its unit: subject present, no text-contradicting detail, policy respected (no photo in a storybook) | storybook, magazine, storyboard |
| **Bench comparison** | audit the unit beside 2 bench exemplars (user-pasted "this quality") and report the gap per dimension | opt-in |
| **Cross-unit repetition at scale** | the existing detector run over the whole work, not adjacent chapters only, on a schedule (job) | book |

All are packs-shaped: a dimension id, an instruction or a deterministic pass, a default
severity — which is the argument for finishing §1–2 before adding them.

## 6. Implementation order

| # | Task | Test |
|---|---|---|
| 0 | **Targeted rewrite** (§5b) — highest user value, needs nothing else; `maxReviewIterations` → 2 (E3) | Fix on one finding changes only that span; other findings' offsets still resolve |
| 1 | Pack schema + loader + builtin `core-37` extraction (E1) | book audit unchanged w/ default pack |
| 2 | Deterministic deltas + thresholds from pack (E2, E3) | pack with added fatigue word flags it |
| 3 | Custom dimensions into prompt (E4) + offsets (E5, E6) | "warmth" pack produces located findings |
| 4 | Resolver + per-type default packs (script/storyboard/translation/publication §3) | each type audits with its pack |
| 5 | Pack editor UI + pack pickers + finding source display | edit→preview loop works |
| 6 | Verdict capture + audit scope in 18 + suppressions | ignored-dimension proposal appears |
| 7 | Bench guard | version bump runs bench, reports drift |
