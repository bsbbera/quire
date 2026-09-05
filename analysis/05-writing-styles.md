# 05 — Writing Style System

## What exists

- Each book has `story/style_guide.md` (free-text, per-book, written once by the architect).
- Studio has a `POST /api/v1/style/analyze` route (style extraction exists in some form).
- The magazine pipeline writes pages with per-definition "publication law" but no
  reusable named styles.
- The shim's `buildPrompt` merges system messages — a clean injection point already exists.

So: style is currently **per-book, unnamed, non-reusable, non-mixable**. The goal is
**named, versioned, composable style packs** selectable in any prompt.

## Style pack format (spec + registry, same pattern as Comfy workflows)

```
workspace/styles/writing/<id>/
  style.json          — machine spec
  voice.md            — the actual prompt block (what the model reads)
  samples/*.md        — 2–5 short exemplar passages (few-shot material)
  rules.jsonl         — appended by the taste loop (04): approved do/don't rules
```

```json
// style.json
{
  "id": "lyrical-noir",
  "label": "Lyrical Noir",
  "category": "voice",                     // see taxonomy below
  "appliesTo": ["book", "short", "publication:feature"],
  "axes": { "formality": 0.4, "pace": 0.3, "ornament": 0.8, "humor": 0.1 },
  "pov": "first-limited", "tense": "past",
  "sentence": { "avgLen": "long", "rhythm": "varied, trailing clauses" },
  "diction": ["concrete nouns", "period slang ok", "no adverb stacking"],
  "forbidden": ["rule of three", "em-dash chains", "purple metaphors > 1/para"],
  "compatibleWith": ["structure/*", "genre/noir", "genre/literary"],
  "conflictsWith": ["voice/minimalist-hemingway"]
}
```

## Taxonomy: categorise on four orthogonal layers

Styles must be **composable**, so categories are layers that stack, not a flat list:

| Layer | Examples | Cardinality per doc |
|---|---|---|
| **Voice** (how sentences sound) | Hemingway-minimal, lyrical-noir, dry-academic, chatty-YA, fable/5-year-old-simple (your OYLA voice), gonzo | exactly 1 |
| **Structure** (how text is shaped) | three-act, kishōtenketsu, epistolary, listicle, Q&A, braided timeline | 1 |
| **Genre register** (vocabulary & tropes) | noir, cozy mystery, hard SF, mythic western, nautical | 0–2 |
| **Audience/format constraints** | reading level, word budget, magazine section type (feature/sidebar/caption), platform norms | 0–n |

Mixing = pick one per layer: `voice/lyrical-noir + structure/kishotenketsu +
genre/hard-sf + audience/YA`. Validation rejects `conflictsWith` pairs and warns when
axes clash (e.g. ornament 0.8 voice + "caption" format).

## Integration points (each production type)

1. **Book creation** — architect UI gets a style-pack picker (per layer). The chosen
   packs are written into `book.json.styles[]` and the architect *derives*
   `style_guide.md` from them instead of inventing one. Per-chapter override allowed
   (e.g. an epistolary interlude chapter).
2. **Magazine** — style per **section type**, stored in the publication definition:
   features get a voice, sidebars get another, captions a third. This matches how real
   magazines work and how quire-core already scopes "law" per definition.
3. **Prompt assembly** (in quire-core's writer stage or the shim's `buildPrompt`):
   ```
   [system] role + truth files
   [system] STYLE: voice.md of each selected pack (voice → structure → genre → audience)
   [system] RULES: last N approved rules from rules.jsonl
   [few-shot] 1–2 samples/*.md excerpts (biggest single lever for style fidelity)
   [user] the actual writing task
   ```
4. **In-chat mention** — support `@style:lyrical-noir` in any Studio prompt box; the
   token is resolved to the pack before the request leaves Studio.
5. **Audit stage** — the auditor receives the style spec and flags violations
   ("adverb stacking", "sentence rhythm too uniform") → style adherence becomes a
   gated, measurable property like the existing audit issues.

## Creating packs (three sources)

- **Curated starter set** — ship ~12 voices, ~8 structures, ~10 genres (a week of writing).
- **Style-from-sample** — user pastes 2–3 pages of any author/own writing; the existing
  `style/analyze` route is extended to emit a draft `style.json` + `voice.md` for
  approval. This is the killer feature: "write like *me*".
- **Taste loop** (04) — redo/tweak feedback distills into `rules.jsonl` per pack, so a
  pack gets sharper the more it's used.

## Storage & versioning

- Packs are files in the workspace → user-editable, git-friendly, shareable
  (a marketplace of style packs is an obvious future revenue item).
- `version` field; chapters record `styles: [{id, version}]` in their sidecar so old
  chapters can be re-audited against the style they were written with.

## Build order

1. Schema + loader (mirror `workflows.mjs`: validate at load, builtin + user dirs). — S
2. Inject into writer prompt for books; picker UI in book creation. — M
3. Section-scoped styles for publications. — M
4. Style-from-sample analyzer. — M
5. Auditor style-adherence checks + taste-loop rules. — M
