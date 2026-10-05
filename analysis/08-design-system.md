# 08 — Design System: Auto-Generated Design Language per Work, per Type

> Rewritten 2026-09-07; absorbs the former `06-design-style.md` (page rules, cutout
> grammar, golden rules). Verified against source: `pipeline/publication-design.ts:21-55`
> (`DesignSpec {palette, type, grid, imageDirection, pages}`), `:129-162`
> (`DEFAULT_DESIGN_PROMPT`, one global spec), `:175-205` (`designReferences()`),
> `pipeline/publication-runner.ts:158-168` (`DesignWorld {n, register, technique,
> idiom, paper, ink, hue, field, devices}` — **defined, never populated**), `:548`
> (`worldFor()` always null), `:1034-1039` (`artPage` sends `brief.prompt` raw —
> `imageDirection` is never injected), `publications/styles.ts` (50-style vocabulary),
> `pipeline/executors.ts:160-198` (`design.artplan` = cover-prompt passthrough),
> `cli-shim/workflows/z-image-turbo.json:26` (the only negative prompt in the system).

## Status

| Piece | State |
|---|---|
| `DesignSpec` (palette/type/grid/imageDirection/pages) generated per magazine | done |
| `DesignWorld` per section | **done (2026-09-11)** — `runDesign` writes `design.sections` (imagePrompt/negative per section) |
| Design references (mood board from `design-references/*.md`) | done, magazine only |
| Design system for books / storybooks / shorts | **done (2026-09-11)** — one world per work, `design/world.json`, chosen from the text on the first art plan (`ensureWorld`, server.ts) |
| Illustration-vs-photo policy per type | **done** — `artPolicyOf()` in `registry.ts` |
| Any design-system fragment reaching the image prompt | **done** — `composeImagePrompt()` in every render path |
| ArtDirector brief contract (§4) | **done (2026-09-11)** — `core/pipeline/art-director.ts`, run by the art plan for book/short/interactive-film; one cover per book, "none" is an answer |
| World card (§6) | **done (2026-09-11)** — on the design desk (Gallery): keep, or re-world with a note; older pictures marked stale |
| Cast Sheet (§9) | **done (2026-09-11), prompt-only** — sheets read off the text, 3 candidates per character, choose or upload; trait line in every brief the character is in. Reference conditioning waits on a workflow that can take one |
| World library, golden rules | not started |
| Golden-rule validator (`checkDesign`) | contrast + section-world validity only |

The single most valuable fact above: the app already generates a design spec and
already has a world type — it just never *uses* them where images are made. Wiring
beats inventing.

## 1. The central object: `ArtPolicy` per production type

The user's rule — *books and stories are illustrated, never photographed; magazines
mix real photographs, illustration, infographics and type* — is a **type-level
policy**, so it lives in the one place types are defined: `productions/registry.ts`.

```ts
// registry.ts — one field per ProductionSpec
artPolicy: {
  surfaces: ["illustration"],                       // what kinds of image may exist
  // magazine: ["photo","illustration","infographic","typographic","texture"]
  mix?: { photo: 0.4, illustration: 0.35, infographic: 0.15, typographic: 0.1 }, // targets, not quotas
  techniques: "pool:narrative",                      // which technique pool the world may draw from
  imagesPerUnit: { min: 0, max: 1 },                 // book: per chapter; magazine: per page {1,3}; storybook {1,1}
  slots: ["opener","tailpiece","plate"],             // allowed slot kinds (09 taxonomy)
  realism: "forbidden" | "allowed" | "preferred",    // drives the negative prompt
  worldScope: "work" | "section",                    // one world per book; one per magazine section
}
```

| Type | surfaces | realism | worldScope | imagesPerUnit |
|---|---|---|---|---|
| book, short, translation | illustration | forbidden | work | 0–1 (opener/tailpiece/plate) |
| storybook | illustration | forbidden | work | 1 per spread |
| script | none (typographic cover only) | — | work | cover |
| storyboard | illustration (line/tonal) | forbidden | work | 1 per panel |
| interactive-film | illustration, photo(optional) | allowed | work | 1 per node |
| publication | photo, illustration, infographic, typographic, texture | allowed | **section** | 1–3 per page |

`realism: forbidden` appends the anti-photo block to every negative prompt
(`photorealistic, photo, photograph, 3d render, cgi, stock photo, dslr, bokeh`).
`allowed` appends nothing; `preferred` appends the anti-illustration block only for
`surface: photo` briefs. Nothing else in the system decides this — not the
ArtDirector, not the world, not the user's brief text.

## 2. The world: one schema, populated for every type

Keep `DesignWorld` and finish it. Rename nothing; add the fields the image side needs:

```ts
interface DesignWorld {
  n: number; register: string; idiom: string;           // existing
  technique: string;                                      // existing — from styles.ts vocabulary
  paper: string; ink: string; hue: string; field: string; // existing — colours
  devices: string[];                                      // existing — layout devices
  // added:
  surfaceDefaults: Record<Surface, { technique: string; palette: string[] }>; // per surface, how it looks here
  imagePrompt: string;      // the fragment prepended to every brief in this world (≤ 60 words)
  negative: string;         // world-specific avoid list (beyond the policy block)
  props: string[];          // recurring objects/motifs (from Setting Bible §1/§6 when present — 22)
  type: { display: string; text: string };
  mood: string[];
  sources: string[];        // design-reference ids used
}
```

Where it lives:
- magazine: `issue.design.sections[]` (the field that exists) — **populate it** in
  `runDesign`, one world per section, sharing `palette.paper/ink` for coherence.
- every other type: `<outDir>/<id>/design/world.json` — one world per work.
- library: `<workspace>/design/worlds/<id>/` for reuse (`@world:riso-fable`), mirroring
  the style library; ships with ~12 curated worlds spanning the technique pool.

### How a world is generated (the "auto" part)

A `design.system` sub-stage runs **once per work, before `artplan`**, for every type
with a design stage (today only magazine has `runDesign`):

```
inputs:  type + artPolicy · content synopsis/section map · genre · audience
         · Setting Bible §1/§6 (22) if present · designReferences() mood board
         · the user's designPrefs (free text) · library world if the user picked one
prompt:  "Choose ONE design world for this <type> ... technique from <pool> ...
          return JSON DesignWorld[]" (per section for magazine, single for others)
check:   checkDesign() extended: technique ∈ vocabulary, contrast ≥ 4.5, surfaceDefaults
         cover every surface in artPolicy, imagePrompt has no forbidden realism words
         when realism=forbidden, ≤ 3 techniques per issue, adjacent sections differ
gate:    part of the design gate — shown as a "World card" (swatches, type sample,
         one test render) with keep / re-world / pick-from-library
```

Technique pools (data file `design/technique-pools.json`, from `styles.ts`):
`narrative` (watercolor, gouache, ink-and-wash, linocut, riso, coloured pencil,
paper-cut, woodcut, pastel, digital-painterly), `editorial` (adds photo-documentary,
studio-still, collage, vector-flat, isometric, data-viz, typographic), `children`
(gouache, crayon, paper-cut, felt, soft-digital), `technical` (line, blueprint,
cross-hatch).

### 2b. World + Kit = the approved design (added 2026-09-10)

A world says *how things look*; the **Design Kit** (07 §1b) is the world made
concrete — named gradients, patterns, text styles, FX set, ornaments, masks,
infographic components, `template.afdesign`. `DesignWorld` gains `kit: "<worldId>@<v>"`.
The design gate approves both at once on the **World card** (magazine: per section on
the Section board, 13 §2): swatches, type sample, gradient/pattern strip, ornament row,
one test render. Approval is the moment "this colour scheme for this section, these
illustrations, this grid" is fixed — the user's requirement that design is finalised
before anything is built. Re-world after approval marks kit assets and images stale
through the existing `withdraw` path (14).

**Prompt implication per type** — why magazine and book prompts must differ:
- *Magazine*: `worldScope: section` → `composeImagePrompt()` reads a **different**
  world fragment, palette and technique for each section, and the kit's mascot /
  ornament ids for reuse. Infographics are block kinds first (kit components), images
  second.
- *Book / short / storybook*: `worldScope: work` → one fragment for the whole work,
  stable across chapters; variety comes from **treatment** (09 §1), and **cutouts are
  the attention device** — a storybook spread that alternates full-bleed with a
  white-ground cutout reads as designed, not generated. Illustrations are
  storytelling-heavy: the brief's `subject` is a *beat* sensed from the approved text
  (a moment, an action, a face), never a mood.

Canva Brand Kit mirrors the approved kit palette/assets (23 §5) so derivatives stay
on-world; it is never the source of truth.

## 3. One function composes every image prompt

Today two call sites build prompts differently and both drop the design system.
Replace with a single `composeImagePrompt(brief, world, policy, setting?)` in core,
used by `artPage`, `design.generate`, the MCP tool, and the gallery's redesign:

```
positive = [ world.imagePrompt,
             world.surfaceDefaults[brief.surface].technique,
             brief.subject,                      // what the ArtDirector wants shown
             TREATMENT_SUFFIX[brief.treatment],  // e.g. cutout: "isolated on plain white, full figure, no ground shadow"
             world.props (2–4 relevant), setting cues ].join(", ")
negative = [ workflow.negative, POLICY_NEGATIVE[policy.realism][brief.surface],
             world.negative, setting.anachronisms ].join(", ")
```

Recorded whole in the sidecar (`recipe.json`, 04) so a regeneration is exact and a
"redesign" edits one component and re-composes.

## 4. The ArtDirector decides *what*, the world decides *how*

`design.artplan` becomes the ArtDirector (21) with per-type behaviour and this
contract per unit:

```json
// art/briefs/<unit>-<k>.json
{ "unit": "ch07", "k": 1,
  "surface": "illustration",              // ∈ policy.surfaces
  "slot": "opener",                        // ∈ policy.slots — where on the page (09 taxonomy)
  "treatment": "half-bleed-top",           // how it sits: full-bleed | half-bleed | vignette | cutout | plate | spot | ornament | texture
  "subject": "…",                          // sensed from the unit's content: the beat, not a caption
  "aspect": "3:2", "size": [1536,1024],
  "mustNot": ["faces of real people"],
  "reference": null | { "kind": "web", "query": "…", "license": "cc" },   // magazine photo briefs
  "reason": "chapter ends on the empty station — tailpiece, small, quiet" }
```

Sensing rules the ArtDirector prompt encodes (per type):
- **Books**: read the chapter; ≤1 image; opener if a new location/character enters,
  tailpiece if the chapter ends on an image-able beat, plate only for set-pieces;
  many chapters get **none** — restraint is the design.
- **Storybook**: one per spread, the spread's art note is the subject, treatment
  alternates full-bleed / vignette-with-white-space so the book breathes.
- **Magazine**: per page from the page bundle; surface chosen by content kind
  (reportage → photo; explanation → infographic; essay → illustration; opener →
  typographic or photo), honouring `mix` over the issue and the flatplan archetype
  (13); adjacent pages never share treatment.
- **Storyboard**: line/tonal panels, no colour unless world says so.

## 5. Page rules (from the former 06) — now validators the design gate runs

Kept as the seven golden rules, implemented in `checkDesign` on the page spec + brief:

1. One dominant element per page (largest image or headline ≥ 40% of the visual weight).
2. 60-30-10 colour distribution from the world (paper/ink/hue) — measured on the render.
3. Whitespace ≥ 25% on editorial pages; storybook text never over busy image regions.
4. Type: one display + one text face per world; sizes from `type.scale`.
5. Grid: every block snaps; images bleed only when treatment says so.
6. Adjacent pages differ in treatment; no three consecutive full-bleeds.
7. Rule-breaking is allowed once per section and must be declared (`spec.breaks:`),
   which the gate shows as a badge rather than a warning.

**Cutout & placement grammar** (needs the rembg workflow, 09): a cutout may overlap a
text column by ≤ 12 mm with text wrap; cutouts sit on the outer edge; a cutout never
faces off-page; watercolor-bleed edges get 6 mm clearance from text. `tk.js` gets
`T.cutout()` and `T.wrapAround()`; the validator checks the geometry from the spec.

## 6. UI

- **World card** in the design gate (keep / re-world / pick from library / edit
  swatches). Re-world regenerates all briefs of the scope and marks images stale.
- **Design page** per creation (Tools rail): the world(s), the policy readout ("this
  is a book: illustration only"), technique pool, references list, and the surface
  mix meter for magazines (target vs actual).
- **World library** page: gallery of curated + saved worlds with a test render each.
- The policy is *shown*, not editable per work — a book that wants photos is a
  different type, not a toggle. (Interactive-film's `photo(optional)` is the one
  per-work switch.)

## 7. Learning (18)

Every design-gate verdict (keep / re-world / redesign with note) and every gallery
redesign note is a taste event with `scope: "world"`. Distillation proposes deltas to
the world's `imagePrompt`/`negative`/`surfaceDefaults`, and — for library worlds —
promotes them. This is how "the user never picks realism for storybooks" becomes a
rule without anyone typing it.

## 9. Cast Sheet: the same character on every page (added 2026-09-07; 11 #4)

The visible failure of every AI-made picture book is that the protagonist's face
changes between spreads. The fix is a per-character reference the generator is
conditioned on, kept in the work's design folder and approved once:

```
<outDir>/<id>/design/cast/<characterId>/
  sheet.json      { name, age, species, wardrobe[], palette[], traits[], approvedAt }
  ref-front.png   ref-side.png   ref-expressions.png     (approved renders, world technique)
  recipe.json     how the refs were made (same sidecar as every image)
```

- **Source**: the cast truth file (`roles`) already names characters; a `design.cast`
  sub-stage after `design.system` renders 3 candidate sheets per named character in
  the work's world (neutral pose, plain ground, full figure) and shows them in the
  design gate as a **Cast card** — pick one, redo with a note, or upload your own
  drawing. Nothing downstream runs until every recurring character has a sheet.
- **Use**: the ArtDirector brief gains `characters: [id]` (sensed from the unit text);
  `composeImagePrompt()` appends the sheet's trait line, and the render seam attaches
  the refs as IPAdapter / reference-conditioning inputs (09 §3b). Wardrobe changes are
  explicit (`wardrobe: "raincoat"` in the brief), so continuity is a choice, not luck.
- **Verify**: the image↔text coherence audit (19 §5c) checks each placed image against
  the sheet (a vision model asked "same character? list differences") and raises a
  design finding with a one-click regenerate.
- **Series** (22 §8): sheets live at series scope when a series exists, so book 3 draws
  the same child as book 1 — aged, if the series bible says so.

## 8. Implementation order

| # | Task | Test |
|---|---|---|
| 1 | `artPolicy` in registry for all 8 types; `POLICY_NEGATIVE` table | book brief negative contains "photorealistic" |
| 2 | `composeImagePrompt()` in core; `artPage` and `generate` both use it; sidecar records components | magazine image recipe shows world fragment |
| 3 | Finish `DesignWorld`; `runDesign` writes `design.sections`; `design.system` stage for non-magazine types writes `design/world.json` | `worldFor()` returns non-null; a book has a world |
| 4 | Technique pools + world library dir + 12 curated worlds | `@world:` picker lists them |
| 5 | ArtDirector brief contract (`surface/slot/treatment/subject/reason`) replacing cover-prompt passthrough | book with 10 chapters → ≤10 briefs, mixed slots |
| 6 | `checkDesign` golden rules + world card in design gate | three full-bleeds in a row → warning |
| 7 | Cutout grammar in `tk.js` (after 09 rembg) | cutout page renders with wrap |
| 8 | Design page + world library UI | — |
| 9 | Taste scope `world` (after 18) | — |
| 10 | **Cast Sheet** (§9): `design.cast` stage, Cast card, `characters[]` in briefs, refs into the render seam (needs 09 `ipadapter-style`), coherence audit hook | 12-spread storybook: protagonist judged "same" on ≥ 11 spreads by the vision check |
| 11 | `DesignWorld.kit` + World card shows kit strip; `design.system` proposes kit from nearest library kit (07 §1b); sensing prompt for book briefs = beat from text | approving a section fixes world + kit; a storybook brief names an action from the spread text |
