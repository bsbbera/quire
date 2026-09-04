# 13 — Magazine Master Plan: Every Page Must Earn a Look

## Why magazine is different (the user's framing, confirmed by the code)

A novel has flow — one voice, one world, pages inherit their look. A magazine has
**no flow**: it is a *sequence of self-contained visual arguments*. The quality bar is
brutal and simple: **a reader who never reads a word should still enjoy flipping every
page.** That means:

- Design cannot be applied *after* content. Content, design world, imagery, and layout
  must be **co-created per page** — the writer must know it's writing 60 words for a
  full-bleed plate, not 400 words for a dense spread.
- One design system is wrong. Like OYLA, **each section gets its own design world**
  (math section ≠ physics section ≠ history section), held together by issue-level
  constants.
- Every page must be individually **inspectable, regenerable, and redesignable**
  without touching its neighbors.

The good news: quire-core's publication engine already believes this. Definitions
carry archetypes, densities (word budgets per page type!), block grammar per archetype,
pillars, recto rules, and a design prompt. What's missing is: per-section worlds,
the page-unit data model, the per-page review/redo loop, and the beauty gate.

## The magazine data model (per page, one bundle)

Everything about a page lives in one folder so it can be rebuilt alone:

```
Magazine/issues/<id>/
  issue.json            — subject, angle, extent, flatplan, section map
  sections/<sec>.json   — section brief + assigned world (08) + palette lock
  pages/<nn>/
    content.json        — body, blocks (didyouknow/bignumber/vs/timeline…), captions, sources
    spec.json           — page spec (06): archetype, world ref, grid usage, dominant, break
    art/                — images + recipe sidecars (04)
    render.png          — latest Affinity render (07)
    reviews.jsonl       — verdicts + notes, page-level and element-level
```

`publication.json` keeps the pipeline state/gates as today; pages become the unit of
work, approval, and regeneration.

## The pipeline, stage by stage (automatic, with user hooks at each step)

Every stage below runs **fully automatically** by default; each has an optional user
touchpoint. The user can ride the escalator or grab any railing.

### 0. Intake (user: 1 prompt + optional answers)
Existing `intake[]` mechanism. Subject, angle, extent, audience. New optional fields:
"mood words", "sections you want", "anything to avoid". That's all a user *must* give.

### 1. Research → Pillars (existing)
Research produces pillars (already law: `requireAllPillars`). *User hook:* pillar list
shown as editable chips before planning.

### 2. Section map + world casting (NEW — the OYLA move)
The planner groups pages into **sections** (one per pillar or theme). For each section
it casts a **design world** (08) using the compatibility matrix:

```json
// sections/cosmos.json
{ "id": "cosmos", "pillar": "astronomy", "pages": [14, 21],
  "world": "cosmic-folklore",           // its own system×technique×props
  "inherit": { "folio": "issue", "masthead": "issue", "bodyFace": "issue" } }
```

**Issue constants vs section freedom** — this is the rule that makes multi-world
issues coherent instead of chaotic:

| Issue-level (never varies) | Section-level (world decides) |
|---|---|
| Trim, margins, baseline grid | Column usage, composition energy |
| Folio/page-number treatment | Display face, type scale ratio |
| Body text face + size | Accent palette, page/text background colors |
| Masthead, TOC style | Image technique (watercolor here, pixel art there) |
| Break budget (06) | Ornaments, icon vocabulary, textures |

*User hook:* **Section board** UI — sections as columns, world thumbnail on each,
drag to swap worlds, lock a section, "reroll world". Approving the board = the plan gate.

### 3. Flatplan with pacing (extend existing plan stage)
Existing planner assigns archetypes/densities. Add pacing law to the definition rules:
- No two dense spreads adjacent (`maxConsecutiveDensity` exists — set it).
- Every section opens with a plate (recto rule exists).
- 1 "wow" spread (specimen poster / shock spread) per section; ≥ 1 breather per 6 pages.
- Section transitions get a palette-shift page so worlds don't collide mid-spread.

### 4. Page authoring — content and design born together (the core change)
Per page, ONE model turn produces a **page bundle**, not prose:

```
in:  section brief + world spec + archetype + density budget + block grammar + pillar facts
out: content.json  — 60/180/350 words (density-budgeted), blocks chosen from the
                     archetype's allowed kinds, captions, big-number candidates
     spec.json     — dominant element, grid usage, cutout intent, color roles, break?
     art briefs    — per image: subject, composition, "isolated on white" if cutout,
                     world's imagePrompt fragment appended (08)
```

Because densities and blocks are already *law from the definition*, the writer can't
produce unlayoutable text — this mechanism exists; we're adding spec + art briefs to
the same turn. Infographics are just block kinds (`timeline`, `vs`, `bignumber`,
`process`, `map`) whose data is structured in content.json — the design layer decides
whether a block renders as TK vectors (07 components) or a generated image.

*User hook:* none needed here — pages flow to review.

### 5. Audit + fact-check + destyle (existing + 12)
Fact-check already exists for publications. Add per-page destyle pass (12) and a
**readability check** for the "attractive writing" requirement: hook lines on plates,
no paragraph > 60 words, every page has one graspable-in-3-seconds element (big number,
question, or image caption).

### 6. GATE 1 — Copy approval, per page
Reader-style review (10's overlay): flip through *text-on-gray* proofs. Keep / redo /
tweak per page; tweak notes go straight back into a single-page re-run of stage 4.
Approving all pages (or bulk-approve) closes the copy gate (exists today at issue
level — make it per-page roll-up).

### 7. Art generation (existing art stage + 04/09)
Per art brief: world's technique workflow → generate 2–3 candidates → rembg cutouts
where spec says so → sidecars with recipes. *User hook:* the review grid (09) filtered
to this page; picking a candidate updates spec.json.

### 8. Layout + render, page by page (07)
Spec → TK program → Affinity build of that page → `render.png`. Per-page build already
exists (`/affinity/page`, `buildPage`); renderPage must be fixed first (07).

### 9. GATE 2 — Design approval: the Beauty Gate (per page, the magazine's soul)
The flipbook shows real rendered pages. Two layers of judgment:

- **Machine pre-screen** (runs before the user sees anything): validator rules (06) +
  cheap visual checks on render.png — whitespace %, dominant ratio, contrast
  (`checkDesign` exists), silhouette quality for cutouts, "two dominants" detection.
  Failing pages are auto-redesigned (different archetype or dominant scale) up to 2×
  before human review. **No page reaches the user looking bad.**
- **Human verdict** per page: 😍 keep / 🔁 redesign (same content, new spec — reroll
  archetype/composition) / 🎨 re-world (assign different world) / ✏️ element tweaks
  (block-level: "image bigger", "background darker", "swap infographic style").
  Every verdict is one gesture; every redo touches only that page's folder.

This per-page redesign loop — cheap, isolated, unlimited — is what makes "every page
attractive" achievable rather than aspirational.

### 10. GATE 3 — Build: full PDF assembly (existing) → Reader (10).
Feedback from all gates streams into the taste engine (04/06) per **world**, so the
cosmic-folklore world learns separately from the nordic-fieldnotes world.

## What the user actually does (the whole UX, summarized)

1. Type a prompt. *(required)*
2. Glance at pillars. *(optional)*
3. Approve/rearrange the Section board with worlds. *(1 minute)*
4. Flip through text proofs, tap redo where needed. *(gate 1)*
5. Flip through rendered pages, tap 😍/🔁/🎨 per page. *(gate 2)*
6. Approve build, read it in the Reader. *(gate 3)*

Everything else — research, flatplan, densities, art briefs, generation, layout,
machine beauty checks, retries — is automatic. Control without burden.

## Build order (magazine-specific, assumes 04/06/07/08 primitives)

1. Page-folder data model + migrate publication runner output into it. — M
2. Section map + world casting stage; Section board UI. — M
3. Page-bundle authoring prompt (content+spec+briefs in one turn). — M
4. Per-page re-run endpoints (rewrite / redesign / re-world / regenerate-art). — M
5. Machine beauty pre-screen on render.png. — M
6. Beauty-gate flipbook UI with the four verdicts. — M
7. Per-world taste accumulation. — L
