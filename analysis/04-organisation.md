# 04 — Organisation: Workspace, Assets, and the Feedback Loop

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

## Build order

1. Sidecar writer in `comfy.mjs generate()` (one function, ~30 lines) — do this first,
   it starts accumulating data immediately.
2. Asset routes + Assets tab in Studio.
3. Feedback buttons → `feedback.jsonl`.
4. Regenerate/variant actions (re-POST `/comfy/generate` from sidecar recipe).
5. Taste-distill job (after 05/06 define style packs to write rules into).
