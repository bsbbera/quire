# 27 — Design from the writing

Decided 2026-10-08, after the three-magazine test (octopuses, night markets,
swing drumming). That test failed its own goal: the look was partly mine.
- **The art prompt carried my recipe:** "big ground shape, middle layer, sharp
  foreground, one shape bleeding off". All three covers came out with the same
  structure.
- **The layouts were mine:** 36 patterns. The model only picked one.
- **The menus were mine:** six panel shapes, three label styles, five rules.
- **No placeholders:** plan 26's wireframe proof (Phase 10) was never built, so
  no page had an image slot and no ComfyUI prompt could come from one.
- **Same taste across creations:** two of three magazines took the same serif pair.

Replaces plan 26's Phases 9–10. Phases 11 (pictures) and 12 (learning) follow
this one.

## The rule

**Code supplies capability and checks errors. Quire supplies every taste call.**

| Code (allowed) | Quire's model (all of it) |
|---|---|
| page size, bleed, grid arithmetic | what the writing feels like |
| drawing primitives (`tk.js`), fonts installed | the direction: density, depth, rhythm, edges, colour logic |
| overlap, text fit, contrast floor (4.5:1) | each page's composition: frames, slots, art |
| scoring and the mend loop | what each image slot shows and why |
| a repetition check against past creations | the house itself, per creation or per series |

No prompt may contain a style instruction. A lint test fails the build if one does.

## The pipeline

```
writing (approved)
  → reading: per page, what the text is and feels like        (A)
  → direction: one design brief for this creation             (B)  ── Gate 1
  → composition: per page, frames + image slots + vectors     (C)
  → validate → repair (≤2 rounds) on the model's own layout
  → wireframe: Affinity build, grey labelled slots, scored    (D)  ── Gate 2
  → ComfyUI prompts from approved slots (Phase 11)
```

## Phase 13 — Reading and direction

1. **Reading:** one call per section, over its full copy. Per page it returns:
   - register and tempo (calm, urgent, playful, solemn…), in the model's words
   - the one thing a reader should see first
   - objects, numbers, timelines, people, places that could be pictured
   - what should be a picture, a diagram, or type alone
2. **Direction:** one call per creation, reading all readings plus the house
   grammar. It writes the design brief:
   - composition principles in its own words: density, depth or flatness,
     symmetry, white space, what touches the edges, rhythm across spreads
   - type behaviour (how big, how tight, how titles meet pictures)
   - colour logic and the art style per section, in words
   - picture vs vector vs type ratio
3. **Different taste per creation:**
   - The house holds only what a series fixes: masthead, type pair, margins. A
     one-off book or a new series gets its own house.
   - Each creation stores a fingerprint: fonts, palette, density, symmetry, slot
     count, art style.
   - The direction call is shown the last 5 fingerprints and told they are taken.
     Code rejects a brief that repeats the type pair or palette and asks again once.
   - The font list sent to the house call is shuffled and includes every installed
     face, not a short list.
4. **Gate 1:** the brief is shown on the section board. Approve, or re-ask with a note.
5. **Delete my taste:**
   - the depth recipe in `pageArtPrompt`
   - the style words in `LANGUAGE_GUIDE`, which keeps only the vocabulary (what
     shape kinds and colour roles exist)
   - the six panel shapes, three label styles and five rules become open values:
     radius, stroke, fill, inset, weight

Done when: the three test subjects give three briefs with different type pairs,
palettes and composition principles, and the prompt lint passes.

## Phase 14 — Composition by the model

1. **One call per page.** It gets the page copy, its reading, the brief, and the
   house grid as named lines. It returns frames in grid units (column and row
   spans), not raw points, because raw points caused the overlaps in the folio test:
   - text frames: title, deck, body, pull, caption, panel
   - **image slots**, each with id, role (hero, inset, texture, cutout), what it
     shows, crop and focus, aspect, and a route: ComfyUI, Affinity vector, or reuse
   - vector art: the shapes, as now, placed relative to the frames
2. **Validator (code):**
   - snaps to the grid
   - checks overlap, text fit at the house's body size, bleed and safe area, contrast
   - returns each violation in plain words
3. **Repair:** the model gets its layout and the violations, and returns a fixed
   layout, for at most 2 rounds. If it still fails, the page is marked failed with
   the reasons. It never falls back to my patterns.
4. The 36 patterns are removed from the prompt. They stay in the code only for old
   issues that already use them.

Done when: every page of the three test issues validates within 2 repairs, and no
two covers share the same frame structure (slot count, text/image area ratio,
symmetry).

## Phase 15 — Wireframe proof in Affinity

1. **Placeholder slots:**
   - grey fill at the exact slot size, with a crop mark
   - a small label: slot id, route, and the first line of what it shows
   - on a non-printing layer named `slots`
2. **Vectors and type** are built final, as now.
3. **Scoring:** the existing beauty score and mend loop run on the wireframe. They
   judge the composition with the slots as grey blocks.
4. **Slot manifest:** `slots.json` per issue, with id, page, size in px at
   300 dpi, aspect, what it shows, the direction's art style for its section,
   and the route. Phase 11 reads this to write the ComfyUI prompts. No GPU work yet.
5. **Gate 2:** approve the spreads, or redo a page with a note.

Done when: a whole issue builds in Affinity as wireframes, every image slot is
visible and listed in `slots.json`, and the spreads pass Gate 2.

## Phase 16 — The test that can fail

1. **Prompt lint:** a list of style words (layer, bleed, depth, bold, minimal,
   foreground…) must not appear in any design prompt outside the vocabulary.
2. Run the same three subjects end to end on dev, through to wireframes.
3. **Pass only if:**
   - the briefs differ in type pair, palette and composition principles
   - the covers differ in frame structure, not only in colour
   - every page has its image slots in Affinity and in `slots.json`
   - no page took a fallback layout
4. One live run at the end, after all four phases are built (build-then-test-once).

## After this

- **Phase 11, pictures:** ComfyUI from `slots.json`, at 1024 px refs (power-cut rule).
- **Phase 12, learning:** your Gate 1/2 choices and Affinity edits feed the next
  brief as preferences, so your taste joins the model's, never replacing the
  per-creation variety.

## Parked 2026-10-09

Stopped by the user mid-test, to fix issues found. Nothing here is committed.

**Built (Phases 13-15, on dev, uncommitted):**
- `core/pipeline/composition.ts`: compose prompt, grid sheet, checks, slot manifest.
- `publication-runner.ts`: direction + readings in the design call, `composePages`
  (≤2 repairs, retry on a failed call, throws when a page cannot be composed),
  rhythm review, fingerprints (`_taste/design-fingerprints.jsonl`), `slots.json`,
  `design.notes`, fresh design session per run, redesign through the composer.
- `visual-language.ts`: open panel and kicker values, no style words.
- `page-art.ts`: no depth recipe; reads the direction, reading and composition idea.
- `house.ts` + `api/house.ts`: other houses' type refused, fonts shuffled.
- `publication-session.ts`: `design-page`/`design-art` are plain calls (no transcript).
- `page-blocks.ts` (score): type over art judged in the colour the builder picks.
- shim: tone-filled labelled placeholders, open panels and kickers, figure unit inside its frame.
- tests: `composition.test.ts` (checks + prompt lint), updated house and redesign tests.

**What the live runs showed:**
- Works: each magazine took its own house and type pair (Siphon, Curfew, Bent
  Meter); Night Markets' direction set itself against Octopuses by name; picture
  slots carry briefs; repairs fix overflow and panel fit.
- Failed or open:
  - pages lost to a failed compose call (Night Markets p1-p2, Swing p3) - retry added, unproven
  - type set in its own ground colour (dark issues) - check added, unproven
  - same top-band structure on most Octopuses pages - rhythm review added, unproven
  - placeholder weight under-reads in H (a grey plate is not a painting)
  - writing-stage garbage title on Octopuses p5 (not design)
  - speed: ~15 model calls per 5-page issue at 1-5 min each; one call stalled 25 min
  - `POST /jobs/:id/cancel` does not stop a running design job
- The last pass (all fixes) was stopped during Night Markets p3; no set finished on it.

**Resume:** `scratchpad/run27.py` drives a set (`ONLY=<type> python run27.py design build`);
houses for test-a/b/c are approved. Renders before plan 27 are in `scratchpad/before27/`.
