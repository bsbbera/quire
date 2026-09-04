# 18 — Auto-Learning (Taste Engine): Implementation Spec

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

## 6. Order

| # | Task | Gate |
|---|---|---|
| 1 | feedback.jsonl writer wired into all gate/verdict handlers (14) | every approve/reject appends an event |
| 2 | Diff capture (spec PUT, chapter PUT, sidecar lineage refs) | edits produce diff events |
| 3 | distill executor + proposals store | run on a seeded feedback file → sane proposals |
| 4 | Taste tab + accept/ignore API | accepted rule appears in rules.jsonl |
| 5 | Context-pack injection + validator-constant write-back | next unit's prompt contains the rule; number rule enforced by checkDesign |
| 6 | Rule-trial regression flag | forced-redo scenario flags the rule |
