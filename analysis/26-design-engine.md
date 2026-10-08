# 26 — The design engine: one house, many worlds

Decided 2026-10-08, after the folio test (contour maps). Quire built five pages
from its own spec, but they were neither beautiful nor varied:
- **One look, hard-coded:** two vector drawings, hills at fixed positions, one
  12-column grid, and a prompt example naming contours+rain.
- **Coordinates written by the model:** this is what set type over type and lost
  words off the frames.
- **No brand across issues:** every issue picked its own fonts and palette.

## The idea

**The brand is a grammar, not a look.** OYLA is recognised by what never
changes: the masthead, the type pair, the margins, how a heading meets a
picture, its devices (fact boxes, annotation arrows), and the folio. The art
style changes with the subject. Quire keeps two layers apart:

- **House book (series, approved once, rarely changed):**
  - masthead, type pair and scale ratio, page proportions and margin canon
  - the grid systems allowed
  - colour logic, for example "paper and ink fixed, one accent per section, by rule"
  - signature devices
  - a **style library:** approved art styles, each with an Affinity vector kit
    and a ComfyUI recipe
- **Section world (chosen per subject, from the house's options):** art style,
  accent colour, motif kit, composition tendency.

**The model chooses, code computes.** The model picks a world, a layout
pattern and what a page should stress. Code turns those choices into geometry,
fits the text, and scores the page.

**Design is decided before pictures exist.** Images are generated for approved
slots only, at their final size.

## The pipeline

```
writing (+ design signals)
  → art direction: per section 2–3 world options     ── Gate 1: choose a world
  → wireframe proof: Affinity build, placeholders,
    vectors and type, scored and mended               ── Gate 2: approve spreads
  → assets: ComfyUI for approved slots only, vectors in Affinity
  → final build, score, mend                          ── Gate 3: beauty gate
  → learning: rules · preferences · exemplars · repetition
```

## Taste learning (no model training)

| Signal | Source | Becomes |
|---|---|---|
| Verdicts + causes | Gates 2, 3 | Text rules scoped to house, world or page type (exists) |
| Choices between options | Gate 1, layout alternatives | Preference weights: style per domain, pattern per content |
| Edits in Affinity | the person's final file vs Quire's build | Number rules |
| Pages kept | everything approved | Exemplars: the 3 nearest go into art direction |
| Usage | every build | A repetition penalty on recent worlds and patterns |

## Execution phases

Phase numbers continue `00-overview.md`.

### Phase 7 — House book and style library
1. `house.json` per series:
   - masthead, type pair, scale ratio, margin canon
   - allowed grid systems, colour logic, signature devices
   - The design stage reads it and never picks the fonts again.
2. Style library: 8–12 art styles (`styles/<id>.json`). Each has:
   - the domains it suits
   - a vector-kit reference and a ComfyUI recipe reference
   - a palette rule and a negative prompt
3. A section world is picked from the library and validated against the house.
4. A House screen: approve the house once, and edit it later.

Absorbs the old Phase 8 world library and kit library.

Done when: two issues of one series share the masthead, type and devices, and
their sections use different styles from the library.

### Phase 8 — Layout engine
1. Grid systems as sets of lines, all addressed by the same slot form:
   columns, modular, thirds, golden ratio (φ), the Van de Graaf canon.
2. A pattern library: 40–60 parametrised layouts, each tagged by archetype,
   density and dominant element, with variants (mirror, emphasis).
3. A solver:
   - fits deck, pull, panel and title to their slots
   - keeps the body's size and grows its frame
   - lets no block overlap another
   - fails the page honestly when the copy cannot fit
4. A vector kit:
   - seeded generators whose positions come from the seed: contours, rain,
     rings, flow lines, hatching, halftone, radial burst, phyllotaxis,
     hex/triangle/Voronoi tiling, blobs, Bauhaus geometry
   - ornaments and five panel styles
5. The design prompt asks for a pattern id plus emphasis, not coordinates. Free
   blocks stay for redesigns that need them.
6. The five folio faults:
   - design notes printed on the page
   - the standfirst over the body
   - text that doesn't fit its frame
   - grey covers and too much accent
   - the slug wordmark, and a running head on the covers

Done when: the folio is rebuilt through Quire and every page passes ≥ 80 with no
dimension under 55, no text lost, and no overlap.

### Phase 9 — Design signals and art direction with options
1. The writing call also emits per page: subject domain, mood, key objects,
   numbers or a timeline, people, place, era.
2. One art-direction call per section returns 2–3 world options from the style
   library, each with a reason and a thumbnail drawn from its vector kit.
3. Gate 1 on the section board: choose one option, or re-ask. The choice is
   recorded.

Done when: a new issue offers different worlds for unrelated sections, and the
chosen one drives the build.

### Phase 10 — Wireframe proof
1. The asset list per page, each asset routed to Affinity vector, ComfyUI or reuse.
2. A build with grey placeholders at exact slot sizes, plus all vectors and type,
   scored and mended.
3. Gate 2: spreads approved in the beauty gate before any GPU work.

Done when: a whole issue is approved as wireframes with no image generated.

### Phase 11 — Pictures, driven by the design (09)
GPU safety first: refs at 1024 px. The laptop has hard powered off twice.
1. GPU safety (cool-down, temperature in the recipe), workflow schema (`mode`,
   `refs[]`, `caps`, `license`).
2. Prompts built from world style + page brief + slot shape; only approved slots,
   at their aspect ratio.
3. Qwen 2.1 generate → extract → edit; `alphaClean`, `cropToObject`, `invert`;
   cutouts and textures.
4. Regenerate-art from the beauty gate; inpaint + Tweak; cast refs for storybooks.
5. Engine settings, workflow/LoRA manager, upscale-2x.

Done when: an approved wireframe issue gets its pictures and builds final with
no hand edits.

### Phase 12 — The learning loop
1. Preference weights from Gate 1 choices and patterns kept or redone. They bias
   the next issue's options.
2. An exemplar library of approved pages: the 3 nearest go into art direction.
3. Fingerprints (style, pattern, palette): a repetition penalty plus an R finding.
4. Affinity edits read back from `my-final/`, turned into number rules for approval.

Done when: after a run of choices, the next issue's options measurably follow
them, and a repeated look is flagged.
