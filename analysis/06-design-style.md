# 06 — Design Style: Layout, Grid, Type, Cutouts, and Breaking Rules

Design style ≠ image style. A page is: **grid + type + color + shapes + icons +
infographics + image treatment (esp. cutouts) + white space**, composed. The code
already knows this — `tk.js` has grid math, palette, faces, motifs, and placeholder
briefs — but the *decisions* live in ad-hoc scripts. This file defines the decision
system.

## The golden rules (why no page should ever look bad)

A page that follows ALL of these is never ugly — at worst it's quiet:

1. **Everything sits on the grid.** 6-col/13.5 pt baseline already exists in TK. No
   element at an arbitrary coordinate; `gx()/gw()/bl()` are the only position sources.
2. **One dominant.** Every page has exactly one biggest thing (image, number, headline).
   If two things compete, the page fails. Enforce: dominant element ≥ 2× visual weight
   of the runner-up.
3. **Type scale is modular.** 3–4 sizes from one ratio (e.g. 1.333): caption, body,
   subhead, display. Never a 5th size on one page.
4. **60-30-10 color.** 60% ground (bone/cream), 30% ink, 10% accent — TK's palette
   already encodes this; make it a validation, not a convention.
5. **Alignment over decoration.** If a page looks bland, first fix alignment and scale
   contrast; only then add motifs.
6. **White space is a material.** Minimum 15% of the live area empty; margins never
   invaded except deliberately (see rule-breaking).
7. **Repetition with one variation.** Recurring elements (folios, rules, section marks)
   identical across the issue; each spread varies exactly one thing.

## Cutouts (deserve their own rules — they're the OYLA signature)

A cutout = subject isolated from background, silhouette interacting with layout.

- **Generation:** generate on plain background (Comfy prompt suffix "isolated on white,
  full subject in frame") → alpha-matte locally with `rembg`/`BiRefNet` (both run
  offline; add as a post-process node in the workflow JSON). Store both original and
  cutout, linked by lineage sidecar (04).
- **Placement grammar:** cutouts may (a) break one grid column edge, (b) overlap a
  headline by ≤ 1 baseline, (c) be text-wrapped with ≥ 8 mm standoff. Never all three.
- **Silhouette quality gate:** reject cutouts whose silhouette bounding-box fill ratio
  is > 0.85 (blobby = boring) or that were amputated by the frame.
- **Scale drama:** the best cutout pages use extreme scale — a beetle at 180 mm or a
  ship at 20 mm. Add `scale: hero|specimen|swarm` to the page spec.

## Breaking rules like an artist

Rule-breaking is only legible against kept rules. Encode it, don't leave it to vibes:

- **The 90/10 law:** per spread, at most **one** deliberate violation; per issue, at
  most 20% of spreads carry one. The spec has a field for it:
  ```json
  "break": { "rule": "grid", "how": "headline rotated 4deg crossing gutter", "why": "chaos topic" }
  ```
- **Legal break catalogue** (pick from, never improvise): bleed off trim; rotate ±2–6°;
  overlap gutter; drop the baseline for a display block; invert 60-30-10 for one shock
  spread; letterform as image (giant glyph cropped); cutout invading the margin.
- **Breaks must be motivated by content** ("why" is required) — a chaos article earns a
  broken grid; a obituary doesn't.
- Because breaks are declared in the spec, the validator *skips* the one broken rule
  and still enforces the rest — controlled anarchy.

## The page spec (contract between design brain and Affinity hands)

Every page gets a JSON spec before any TK script runs (this formalizes what
`TK_CFG.spec` half-does today):

```json
{
  "page": 7, "archetype": "specimen-poster",       // from a flatplan archetype list
  "world": "nordic-fieldnotes",                    // design world, see 08
  "dominant": { "kind": "cutout", "asset": "art_01J…", "scale": "hero" },
  "grid": { "cols": 6, "used": [[1,4],[5,6]] },
  "type": { "display": "Haettenschweiler/64pt", "body": "Lora/9.5pt" },
  "colorRoles": { "ground": "bone", "accent": "actFeel" },
  "blocks": [ …ordered content blocks with col spans… ],
  "break": null
}
```

- **Flatplan archetypes** give issue-level pacing: opener → dense spread → breather →
  specimen poster → infographic → closer. The planner assigns archetypes so two dense
  spreads never touch — this is how "not a single page looks bad" scales to 60 pages.
- The spec is validated (rules 1–7) *before* Affinity runs → cheap failure.
- `checkDesign` in quire-core already validates contrast and shared typefaces — extend
  it with these rules rather than building a second validator.

## Continuous feedback system (the taste engine)

1. **Render → review:** after each page build, `renderPage()` (fix it first, see 07)
   produces a PNG shown in Studio with the spec beside it.
2. **One-gesture verdicts** on the *page*: keep / redo / tweak — and on *elements*
   (click a block → "smaller", "move", "different image"). Element feedback maps back
   to spec fields mechanically: "smaller" → scale tier down, "too crowded" → drop one
   block, raise whitespace.
3. **Edits are diffs:** when the user hand-edits a spec (or the Affinity doc), diff
   spec-before vs spec-after → candidate rules ("user reduces display size on text-heavy
   pages") → approval queue → approved rules append to the **world spec** (08), so the
   next issue starts where this one ended. This is your `mag-taste` skill, running
   in-app, on structured data instead of prose.
4. **Never silently apply learned rules** — always the approval queue. Taste drift
   without consent is how systems get worse.

## Build order

1. Page-spec schema + validator (extend `checkDesign`). — M
2. Archetype flatplanner in the plan stage. — M
3. Cutout post-process (rembg) + placement grammar in TK. — M
4. Page-review UI with verdicts (needs 07's render fix). — M
5. Spec-diff taste loop. — L
