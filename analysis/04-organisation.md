# 04 — Organisation: Workspace, Assets, and the Feedback Loop

## Status (2026-09-07)

| Piece | State |
|---|---|
| Images written into the production folder (`art/`, `art/generated/`) not only Comfy's output | done |
| Recipe sidecar | **done (2026-09-11)** — `comfy.mjs generate()` writes `<image>.recipe.json` for every render with a file (09 §4) |
| Gallery tab, approve / redesign / delete / trash, image routes | **done (2026-09-11)** — Gallery on the rail (`GalleryPage.tsx`), `/api/v1/assets*` (`api/assets.ts`): choose, redraw with a note (lineage), trash, restore, delete forever |
| Inline images in audit/review views | **done** — the audit screen's strip leads with the page's own pictures (2026-09-11) |
| Feedback capture → `feedback.jsonl` | **done (2026-09-11)** — `_taste/feedback.jsonl` (`api/taste.ts`) from the Verdict control, gates, finding settles, page notes, the design desk |
| `<Verdict>` with cause chips (§7) | **done (2026-09-11)** — `components/Verdict.tsx` on every picture and on the page being read; keep chooses, reject trashes, redo redraws with the causes, a page redo files a finding |
| `final/` + Learn from final (§6) | **done (2026-09-11), text + PDF** — folder is `my-final/` (a short's pipeline writes `final/`); sentence diff, voice drift → proposals, PDF pages vs build, pictures → kit drafts. `.afdesign` read-back not yet |
| Treatment switch (09 §1) | **done (2026-09-11)** — re-treat a picture from its kept original, no redraw |
| Workspace resolution centralised (`workspace.mjs`), config outside the workspace | done (not in the original plan) |
| Short-fiction copies kept in step (`recompose.ts`) | done (not in the original plan) |

Gallery is now the **first UI deliverable** after the pipeline: everything downstream
(redesign with a note, per-treatment review, taste evidence, LoRA training data in
09 §2 route C) needs its verdicts.

## What exists today

```
~/Quire/                          (workspace; QUIRE_WORKSPACE env override)
  inkos.json  .env
  books/<bookId>/
    book.json
    chapters/index.json, <n>_<title>.md
    story/ (truth .md files, roles/, outline/, state/*.json)
  Magazine/issues/<id>/
    publication.json
    pages/<nn>-written.md
    art/  _assets/  build/
  shorts/  dramas/  storyboards/  interactive-films/  worlds/  translations/
  covers/
  workflows/*.json          (user Comfy workflows)
  .quire/comfy.json
```

Plus scattered outputs: ComfyUI's own `output/`, Desktop staging
(`Desktop/Quire/<issue>/_assets`), Affinity PDFs bounced via Desktop.

**Good:** production-type → folder mapping is clean; truth files give books a canon.
**Bad:** images are second-class citizens. They land wherever `outFile` points, with
no metadata, no registry, no per-story library, no way to regenerate one.

## Principle: every artifact is (file + sidecar + registry entry)

### 1. The asset sidecar (the key missing piece)

Next to every generated image, write `<name>.png.json`:

```json
{
  "id": "art_01J...",
  "kind": "illustration",              // cover | illustration | cutout | texture | infographic
  "belongsTo": { "production": "publication", "id": "issue-042", "page": 7 },
  "recipe": {
    "engine": "comfy", "workflow": "z-image-turbo",
    "prompt": "...", "negative": "...", "seed": 123456789,
    "width": 1024, "height": 1536, "settings": { "steps": 8, "cfg": 1.0 },
    "stylePack": "watercolor-editorial-v2",     // links to design system (08)
    "character": "xiaohei"                       // recurring-cast link (05/06)
  },
  "lineage": { "parent": "art_01H...", "changeNote": "warmer palette" },
  "feedback": [{ "at": "...", "verdict": "keep|redo|tweak", "note": "less clutter" }],
  "usage": [{ "doc": "issue-042", "page": 7, "slot": "hero" }]
}
```

This single file solves four requests at once:
- **Remake with same taste** → re-run `recipe` with a new seed, or same seed + edited prompt.
- **Variations** → lineage chain shows every attempt and why it changed.
- **Feedback** → verdicts accumulate; a taste engine (06) can mine "redo" notes.
- **Where used** → safe cleanup, and reuse across issues/stories.

### 2. Per-production asset library (what the user sees)

**Gallery requirements (decided 2026-09-01):**
- **Storage**: every image lives in the production's own working folder
  (`<outDir>/<id>/art/...`) — never only in ComfyUI's output tree. The generate
  executor writes there directly (with sidecar).
- **Inline where the work is**: images appear in the audit/review view of their unit
  (chapter page / issue page) as soon as they exist — not only in a separate screen.
- **Per-creation gallery tab** on every book/issue with these actions per image:
  - **Approve** (select as the unit's image; others stay as candidates)
  - **Redesign** — reopens the brief with a new style/prompt note → new generation,
    linked via `lineage` (remake-with-new-taste)
  - **Delete** — moves file + sidecar to `<id>/art/.trash/` AND removes from the
    working set (folder-level delete, recoverable)
  - **Permanently delete** — removes from disk entirely (trash included), purges
    index entries; confirm dialog; the only true destructive action
- Gallery is driven by the SQLite index (14 §1.2b) but files remain the truth.

Organise images **per story/issue first**, with a global library view on top:

```
Magazine/issues/<id>/art/
  covers/   pages/07/   cutouts/   rejected/
books/<bookId>/art/
  cover/  chapters/03/  characters/<name>/
_library/                 (workspace-global, content-addressed or symlinked)
  characters/  styles/  textures/  reusable/
```

UI: an **Assets tab inside each book/issue** (grid, filter by kind/page/verdict,
"Regenerate", "Variant", "Promote to library") plus a **global Library page**. The
Studio API needs ~4 new routes (`GET/POST /api/v1/assets…`), all reading the sidecars —
no database needed at first; a `sqlite` index can come later for search speed.

### 3. Same treatment for non-image artifacts

| Artifact | Sidecar contents | "Remake" means |
|---|---|---|
| Chapter/page text | model, stylePack (05), prompt hash, audit results | rewrite with same style, new content |
| Page layout | design world + spec (06/08), TK component list | re-run Affinity script for that page |
| PDF build | issue snapshot hash, font list, export preset | reproducible builds |
| Cover | recipe + type lockup spec | re-render text-safe variants |

The publication pipeline already snapshots gates/approvals in `publication.json` —
extend, don't replace.

### 4. Feedback capture — make it one gesture

Studio already has `POST /api/v1/publications/:id/feedback`. Generalize:

- Every asset/page card gets 👍 keep / 🔁 redo / ✏️ tweak (opens a one-line note box).
- Feedback is appended to the sidecar **and** to a workspace-level
  `_taste/feedback.jsonl` stream.
- A periodic "taste distill" job (this is exactly your `mag-taste` skill, in-app) turns
  the stream into candidate rules ("user always removes drop shadows", "prefers warm
  palettes for history topics"), shows them for approval, and appends approved rules to
  the relevant style pack / design world spec. Taste then compounds across issues.

### 5. Other organisational options worth adding

- **Trash, not delete** — `rejected/` folders already implied; make deletion a move.
- **Issue snapshots** — zip of publication.json + pages + sidecars at every gate
  approval → rollback and diffing ("what changed since copy-approval?").
- **Naming convention** — `p07-hero-v3.png` (page, slot, version) everywhere; the
  sidecar carries the truth but humans browse folders.
- **Content-addressing for the global library** (hash filenames) to prevent duplicate
  11 MB PNGs when the same texture is promoted twice.

### 6. The `final/` folder — the user's last word becomes the next default (added 2026-09-10)

Every creation gets a `final/` folder the pipeline never writes to:

```
<outDir>/<id>/final/
  <title>.afdesign     the Affinity document after the user's own edits
  <title>.pdf          the print file they actually sent / kept
  <title>.md           the text they consider final (chapters concatenated, or pages/)
  assets/              anything they dropped in (a gradient, a pattern, a photo)
  final.json           written by Quire on ingest: hashes, diff summary, learnedAt
```

A **"Learn from final"** button (manual trigger, per creation) runs the `taste.ingestFinal`
job:

1. **Text**: diff `final/*.md` against the last approved units → sentence-level diffs
   become `surface: content` taste events with the diff attached (18 §1). Voice
   fingerprint of the final text (05) updates the style pack's *observed* profile;
   large drift ("user shortened every paragraph by 30 %") becomes a rule proposal.
2. **Design**: open `final/*.afdesign` through the Affinity bridge and read back what
   is there — swatches, gradients, text styles, symbols, FX, page geometry. Anything
   not in the approved Design Kit (07 §1b) is proposed as a **kit asset** (route C,
   with a preview) and any changed parameter (a warmer paper, a heavier rule, a
   different display size) becomes a `world` scope proposal. Per-page geometry that
   differs from `spec.json` becomes a `specBefore/specAfter` diff (18 §1).
3. **PDF**: rasterise and compare page-by-page with the last `render.png` — moved or
   removed images become image verdicts (`redo`/`reject`) with "moved by user" notes;
   image crops become treatment feedback.
4. **Assets**: files in `final/assets/` enter the gallery as `source: user`, and the
   kit as drafts.
5. The whole thing lands as proposals in the Taste tab (18 §3) — nothing applies
   silently — plus a summary card: "12 text edits, 3 new kit assets, 2 palette shifts".

This is the compounding loop the user asked for: *keep the final, press one button,
the next creation starts from your finished work, not the generator's.*

### 7. Feedback everywhere — one component, one question

Every artefact card (chapter, finding, image, page, world, kit asset, build) carries
the same `<Verdict>` control: keep · redo · tweak (one line) · reject. **Every
negative verdict asks "what went wrong?"** as chips specific to the surface —

- content: too long · unclear · dull · wrong tone · factual · off-setting · other
- image: doesn't match text · wrong style · too busy · realism · bad crop · character off · other
- design: too busy · dull · wrong colour · type too small · image doesn't fit · generic · other
- build: text overflow · fonts · bleed/safe · colour off · other

— optional free text, never required. Chips are enums in the taste event
(`cause`), so distillation can count causes, not parse prose. The control is the same
React component on every screen (02), fed to `_taste/feedback.jsonl`.

## Build order

1. Sidecar writer in `comfy.mjs generate()` (one function, ~30 lines) — do this first,
   it starts accumulating data immediately.
2. Asset routes + Assets tab in Studio.
3. `<Verdict>` component with cause chips → `feedback.jsonl` (§7).
4. Regenerate/variant actions (re-POST `/comfy/generate` from sidecar recipe).
5. `final/` folder + "Learn from final" ingest job (§6) — text and PDF first, afdesign
   read-back once 07 §1b kit exists.
6. Taste-distill job (after 05/06 define style packs to write rules into).
