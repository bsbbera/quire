# 25 — Pages built from the spec

> Planned 2026-10-07. Phase 5 of `00-overview.md`, between the page score
> (Phase 4, closed) and the approval UI (Phase 6), which shows these renders.
>
> **Status 2026-10-07: built; fixture verified live (score 99).** See
> `00-overview.md` Phase 5 for what is open and where the build differs from
> the steps below. Correction to "Why": `tk.js` already took the spec's
> palette and its fonts when installed; the grid and the blocks were the gaps.

## Why

A hand-made reference page (PETRICHOR No. 07, p.14 — a feature opener on
Mawsynram) is beautiful for reasons that are mostly arithmetic: one dominant
holding ~51 % of the sheet, five type levels with steps ≥ 1.2×, one shared
left edge, a 60-30-10 palette with neutrals tinted toward the field colour,
contrast past 7:1, a drop cap exactly three body lines tall, 35–50 characters
a line, and a single declared transgression (a numeral crossing the picture's
edge).

Quire can drive Affinity but cannot build that page today. Checked in the code:

- `onePageScript` (`cli-shim/affinity.mjs`) draws a fixed arrangement per page
  type (map, cover/plate/photo-spread, statement, editorial). The spec's
  `pages[n].blocks` are never read: Photography p.8's spec asked for a top
  hero, a `pull-number`, a `sidefact` and a `comparison`; Affinity got title,
  deck and two columns.
- Block kinds and slots are free strings the design model invents
  (`"col-10-12-upper"`), so nothing could read them reliably anyway.
- Fonts and grid are hard-coded in `affinity/tk.js` (`F.disp = 'Bodoni MT'`,
  Franklin Gothic, 6 columns); `spec.type` and `spec.grid` stop at the spec.
  Only the section's colours reach Affinity.
- There is no verb for a figure, drop cap, notes panel, kicker, running head
  or wordmark, and no drawn (code-made vector) art.
- The brand's fixed furniture (`design.fixed.folio/trim/grid/divider`) is prose.
- The score does not check type-scale steps (written in design-skill §12b,
  not implemented), accent-on-ground contrast, the shared left edge, or line
  length.

## Steps

1. **A closed block vocabulary.** `BlockKind` in core:
   `image · drawn · figure · title · deck · kicker · body · dropcap · pull ·
   panel · runhead · wordmark · rule · folio`. A slot is grid arithmetic, not
   prose: `{ col, span, row, rows }` in columns and baseline units, plus
   `crosses?: "image-edge"` for a deliberate transgression. `checkSpec` refuses
   unknown kinds, slots off the grid, and overlaps. Old free-string blocks
   are mapped where they are unambiguous (`pull-number` → `figure`,
   `sidefact` → `panel`) and reported otherwise.
   Content the blocks need comes from the page: `figure {value, unit, caption}`
   and `notes [{label, value}]` join the page schema next to the existing
   `pullQuote` and `furniture`; the content stage writes them, the audit
   checks the figure against the page's sources like any other number.

2. **The spec reaches Affinity.** `spec.type` (display, text, scale) and
   `spec.grid` (columns, gutter, margin, baseline) replace `F`, `NCOL`, `GUT`
   and `COLW` in `tk.js` per issue. **Font preflight** (moved here from
   Libraries): list the fonts Affinity can use, hand the list to the design
   prompt so it picks only installed faces, and map a missing face to a
   named fallback with a finding, never a silent substitution.

3. **Toolkit verbs** in `tk.js`, each tagging its frame with its role so
   INSPECT and the score see it: `T.figure` (oversized numeral, may cross an
   image edge when declared), `T.dropcap` (sized to N body lines, not points),
   `T.panel` (label/value rows on a field), `T.kicker`, `T.runhead`,
   `T.wordmark` (fitted to a measure), `T.rule`, and `T.drawn(kind, seed)` —
   contours, rain, grain, pattern as Affinity vectors, seeded so a re-layout
   draws the same picture.

4. **`onePageScript` becomes a spec interpreter.** It places the page's blocks
   in order onto their slots. The current per-type arrangements stay as the
   default block lists for a page whose spec declares none, so every existing
   issue still builds. Page variants (`small-band`, `pull`, …) become rewrites
   of the block list, so the Phase 4 mend loop keeps working unchanged.

5. **The design stage asks for it.** The design prompt gets the vocabulary,
   the slot grammar, the installed fonts and the rules as numbers (one
   dominant at 40–60 % of weight, scale steps ≥ 1.2×, at most one
   transgression per section, counted against `maxBreaksPerSection`). The
   brand's fixed furniture becomes structured: `wordmark`, `runhead`, `folio`
   as blocks with styles, the same on every page of every issue.
   `drawn` joins the art ladder (Affinity vectors → drawn-by-code → ComfyUI),
   so a page can be finished before Phase 7's GPU work exists; an `image`
   block with no picture yet gets a labelled stand-in frame.

6. **The score learns the missing rules** (numbers in `math.json`):
   - spec-lint: adjacent scale steps < `minScaleStep` (1.2); text colour on
     its ground below 7:1 body / 3:1 display; a `crosses` not declared in
     `breaks`.
   - page-score: text frames whose left edge is on no shared column edge (G);
     line length outside `measure` (35–75 characters, from frame width and
     font size) (T); drop cap not a whole number of body lines (T).

## Live test (one pass, at the end)

1. A fixture issue that re-expresses the PETRICHOR page as content + spec,
   built through `POST /publications/:id/pages/:n/score {layout: true}`.
   Affinity's render matches the HTML reference in arrangement, and the page
   scores ≥ 80 with no G or T finding.
2. Photography: the design stage re-run with the vocabulary; p.8 builds its
   hero, figure and panel, and the mend loop still runs.

**Done when:** Quire builds a page from its spec alone — blocks, fonts, grid,
furniture — in Affinity, with no hand edits, and the score checks every rule
the spec declares.
