# 13 — Magazine Master Plan: Every Page Must Earn a Look

## Revision 2026-10-05 — our own brand, the connection web, one pipeline

Three decisions from the user, each replacing older parts of this plan.

### A. Our brand: one thing, every connection

OYLA and Vogue are teachers, not templates. What we learn from them:
- **OYLA** — wonder first (a question a child cannot resist, never a lesson);
  hard ideas shown as pictures and diagrams; regular sections that make readers
  feel at home.
- **Vogue** — a point of view (it judges, it curates "what matters now"); pictures
  that argue; a type signature you know across a room.
- **Both** — a brand is a *fixed way of looking* plus *signatures that never change*.
  The subject changes every issue; the lens and the signatures do not.

**Our lens:** one subject at the centre, followed outward through every
connection — origin, evolution, science, culture, philosophy, psychology, people,
places, art, where else it appears, the reader's own life. Reference: the Indigo
issue (a colour followed from 6,000-year-old cloth to Gandhi, Newton and denim;
the green-turns-blue moment recurs across features). Promise in one line:
**"One thing. Every connection."** The centre may be a colour, object, material,
place or idea.

**Brand book** = `house_style.md`, draft 1 at `<workspace>/Magazine/house_style.md`.
Wiring needed: the rule stack reads it only per series
(`Magazine/series/<slug>/`, `publication-runner.ts` `seriesDirOf`), and issues set
`series` to their subject, so a brand-wide file is read by nobody today. Read the
magazine-level file first, then the series file (series wins). Contents
(`utils/rule-stack.ts` already lists the filename):
name and promise; voice (3 words, 5 do / 5 don't, 2 sample paragraphs); the
recurring sections; type pair; grid constants; colour rule; motif rule. The
`voice` prompt in `publications/magazine.json` drops "in the register of OYLA,
VOGUE and DESIGNARTMAG" and points at the brand book instead.

**Signatures (every issue):**
- **The Map** — a spread drawing the whole connection web; our signature page.
- **Where Else** — the subject found in unexpected places.
- **Voices** — real people, real quotes, always from a cited source; never invented.
- **In Your Hands** — the closing page lands in the reader's own life and answers
  the opening question.

**Design constants vs variables:** fixed — type pair, grid, folio, masthead, the
signatures' layouts, connection lines as visual language (thread lines, folio notes
"→ p.14"). Per issue — the centre's colour as the single accent (everything else
quiet) and one motif taken from the subject (stitching for denim, veins for a leaf).
Per-section worlds (§2) stay, but inside these constants.

### B. The connection web replaces the pillar checklist

Today `prompts.pillars` says "the issue must cover all six" — a coverage checklist,
which reads as an encyclopedia tour. The writer sees only `{{neighbours}}`; nothing
records how page 9 connects to page 31.

New flow, inside the existing stages:
1. **Research → map.** Output adds `web`:
   `{ centre, rings[], nodes[{id, ring, fact, source}], links[{from, to, why}], threads[] }`.
   Rings are chosen by how rich the research is — not all every time. 3–5 **threads**
   are motifs/people/moments that can recur (Indigo: green→blue, denim, the Indigo Revolt).
2. **Plan walks the map.** Sections are journeys through rings; each page carries
   `links: [{to, why}]` and `threads: []`; the last section returns to the opening
   question. The six pillars become ring names, not a quota.
3. **Page prompt** gets `{{links}}` and `{{threads}}` beside `{{neighbours}}`, so
   bridges are written on purpose.
4. **Writing rules** added to `skills/quire-magazine-page/SKILL.md`: subheads are
   twists that tell the story read alone; one wonder moment per issue echoed ≥ 2×;
   the ending returns to the opening and to the reader; hard history stays in.
5. **Audit** (in `magazine-bar.ts`, plain text checks): every page ≥ 1 link written;
   each thread appears ≥ 3×; last page answers page-1's question; Voices quotes all
   carry a source.

### C. One pipeline (the magazine is not a second engine)

- **Start inside Quire.** An issue is created only through Quire's own create path
  (`publication_create`). The personal `mag-content` skill is outside the app; its
  runs never reach the publication store. Quire-side, the brand book + the web above
  replace what that skill did.
- **Runner → executors, stage by stage.** `publication-runner.ts` (2,572 lines, own
  `STAGE_ORDER`, two state files) is moved onto the shared `SPINE` one stage at a
  time as executors registered for `publication`; `pipeline.json` becomes the only
  run state. Gates, cancel, rail cards and taste then come from the shared pipeline.
  No big-bang rewrite: each moved stage must leave the run working.
- **Picture text at slot time.** The writer's `image_prompts` already describe only
  objects, and style is already added at art time (`publication-runner.ts` ~1248,
  `composeImagePrompt`). Remaining: the brief becomes editable in the gallery
  ("edit description → redraw") so a picture changes without touching the text.

**Status 2026-10-05 — built on `dev`, unit-tested, not yet run live:** 1–7 below
(brand book read from `Magazine/house_style.md`; web after research; links,
threads and rings in the plan; page prompt lines; connection audit; the four
signature page types with `requireTypes`/`closingType`; one accent + motif +
`linkNote` + `webMap` in the layout; runner stages as shared-pipeline executors;
gallery "Edit description"). Not done: "issues created only via Quire" needs no
code — `mag-content` is a personal skill outside the app; Quire now takes its
voice from its own skill and keeps `mag-content` claimed only for the redirect.
Still open from the older list: section board, page bundles, Page Score, beauty
flipbook.

### Build order (this revision; the older list below still applies after it)
1. Brand book draft in `house_style.md`; `voice` prompt points at it.
2. `web` in research output; `links`/`threads` in the flatplan; `{{links}}`/`{{threads}}`
   in the page prompt; skill rules.
3. Audit checks (links, threads, ending, sourced voices).
4. Signature page types: map, where-else, voices, in-your-hands (as archetypes).
5. One-colour + motif rule into the design stage's issue constants.
6. Issue creation only via Quire; then runner stages → executors, one at a time.
7. Editable picture brief in the gallery.

## Status (2026-09-11)

Built: writing bar as audit findings (`magazine-bar.ts`, audience from `issue.audience`),
surface mix against `artPolicy.mix`, beauty pre-screen on each rendered spread, personal
sources (notes folder + Zotero) as the first research source, recurring issues, the two
skills in `core/skills/`. Not built: section board with per-section approval (the design
desk already shows one world per section), auto-redesign of a failing page, page bundles.

## Status (2026-09-10)

Added §4b writing bar (five-year-old clarity, example over definition, did-you-know,
no subject labels, section = unit of approval) and the design skill
(`analysis/design-skill.md` → `quire-editorial-design`, layout/measurement) and the
illustration skill (`analysis/illustration-skill.md` → `quire-illustration`, §5.1
magazine process) as separate authorities that meet via slot → asset;
Canva derivatives + learn-from-final hooks. As of 2026-09-07 —
Done: pipeline stages for `publication` (research→plan→write→factcheck→audit→destyle
| artplan→generate→review | layout→export) run through the orchestrator; `DesignSpec`
generated; per-page `placePage`/`artPage` exist; flatplan rules in `checkPlan`.
Not done: `design.sections` (worlds) never written so `worldFor()` is null and every
page falls to toolkit defaults; `imageDirection` never reaches Comfy; page bundles
(`pages/<nn>/{content,spec,briefs}`) not adopted; no section board, beauty pre-screen,
flipbook gate, or per-world taste. The world population and prompt composition are now
specified centrally in **08 §2–3** (do them there, once, for all types); this plan keeps
the magazine-specific parts: section casting, archetype flatplan pacing, surface mix
meter (photo/illustration/infographic targets from `artPolicy.mix`), beauty gate.

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

### 4b. The magazine writing bar (added 2026-09-10)

A magazine sells on the flip, and reads only if the copy is as designed as the page.
These are **rules the `quire-magazine-page` skill (17 §2 #5) enforces and the audit
pack `magazine-readability` (19) checks**, per page, before the content gate:

| Rule | Check |
|---|---|
| **Five-year-old clear**: one idea per page; sentences ≤ 14 words avg; no unexplained noun a child would not know (glossary chip instead) | readability grade ≤ 4 for `child-5/general`, ≤ 8 for `teen` |
| **Example over definition**: every concept opens with a concrete scene or object, the definition (if any) comes second and ≤ 1 sentence | first sentence contains a concrete noun/action, not "X is…" |
| **Did-you-know** block on every spread, genuinely surprising, fact-checked against `sources.jsonl` (22) | ≥ 1 `didyouknow` per spread; each has a source id |
| **Big number** where numbers exist; numbers always compared to something a child knows ("as heavy as 40 elephants") | `bignumber.compare` present |
| **Question hooks**: every feature opens on a question the page then answers | first block is `question` or the deck ends with `?` |
| **No subject labels**: section names are ways of looking ("Zoom in", "Long ago"), never "Physics" | banned-word list per audience; section names ≤ 3 words |
| **Story spine**: each section is a 3-beat arc across its pages (wonder → how → so what) | flatplan carries `beat` per page; audit checks the order |
| **Copy fits the plate**: word count within the audience cap (design-skill §1) | hard fail |

The **section is the unit of approval**: the Section board (§2) shows each section's
world, kit, opener thumbnail, page beats and the first page's copy proof; approving a
section approves its voice, its visual world and its plan together. Everything
downstream (art, layout) inherits from that approval, and a re-world of one section
never touches its neighbours.

### 5. Audit + fact-check + destyle (existing + 12)
Fact-check already exists for publications. Add per-page destyle pass (12) and the
**readability pack** above (hook lines on plates, no paragraph > 45 words for the
OYLA bar, every page has one graspable-in-3-seconds element).

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

- **Machine pre-screen = Page Score** (design-skill §12b): seven measured dimensions
  (grid, hierarchy, whitespace/balance, colour, typography, image fit, rules) from
  spec + render.png + asset metadata; pass ≥ 80 with no dimension < 55. A failing
  page is redesigned by its **cause**, not blindly: G/T → repair spec, H/W →
  re-archetype, C → recolour, I → back to the asset graph for that slot only (09 §0),
  R → repair. Up to 2 automatic passes, each logged in `pages/<nn>/score.json`.
  **No page reaches the user looking bad, and none is re-rendered for a layout fault.**
- **Human verdict** per page: 😍 keep / 🔁 redesign (same content, new spec — reroll
  archetype/composition) / 🎨 re-world (assign different world) / ✏️ element tweaks
  (block-level: "image bigger", "background darker", "swap infographic style").
  Every verdict is one gesture; every redo touches only that page's folder. The
  score card sits beside the page with its cause line; the "what went wrong?" chips
  are the same seven dimension names, so a human verdict and a machine score feed one
  learning stream (18 §8).

This per-page redesign loop — cheap, isolated, unlimited — is what makes "every page
attractive" achievable rather than aspirational.

### 10. GATE 3 — Build: full PDF assembly (existing) → Reader (10).
Feedback from all gates streams into the taste engine (04/06) per **world**, so the
cosmic-folklore world learns separately from the nordic-fieldnotes world. Optional
`build.derivatives` (23 §6): promo carousel / cover reveal via Canva from the approved
PDF and kit. The user's hand-finished `final/` (afdesign + pdf + md) is read back on
demand ("Learn from final", 04 §6) into world, kit and voice taste.

## What the user actually does (the whole UX, summarized)

1. Type a prompt. *(required)*
2. Glance at pillars. *(optional)*
3. Approve/rearrange the Section board with worlds. *(1 minute)*
4. Flip through text proofs, tap redo where needed. *(gate 1)*
5. Flip through rendered pages, tap 😍/🔁/🎨 per page. *(gate 2)*
6. Approve build, read it in the Reader. *(gate 3)*

Everything else — research, flatplan, densities, art briefs, generation, layout,
machine beauty checks, retries — is automatic. Control without burden.

## Sources: the personal magazine (added 2026-09-07; sellable feature 11 #6)

The research stage searches the web. Let it also read **the user's own material** and
the issue becomes a monthly artefact of their reading — the recurring use a
subscription needs. The engine already has a `materials/` ingestion + FTS5 retrieval
path (`ingest_material`, `input-governance.ts`); this points the magazine at it.

- **Source connectors** (`sources.json` on the publication definition): folder of
  markdown (Obsidian vault, filtered by tag/date), Zotero (local SQLite or web API),
  RSS/newsletter archive (mbox/EML folder), browser bookmarks export, Readwise/Omnivore
  exports. Each yields items `{title, url, date, text, tags, highlights[]}`.
- **Issue recipe**: "Everything I read in August, tagged #science" → section map from
  tags/clusters (the Planner clusters items, not topics), features from long items,
  sidebars from highlights, a "what I kept" index page with sources, and the design
  world chosen from the dominant subject. Fact-check runs against the *source item*
  first (`sources.jsonl` from 22) so quotes are exact.
- **Schedule**: a `recurring` flag on the publication (monthly / weekly) enqueues the
  research+plan stages automatically and stops at the content gate — the user only
  approves; the issue then designs, builds, and lands in the Reader (and, with 07
  §Print, in the post).
- **Privacy**: personal sources never leave the machine except as prompt content to the
  user's own model provider; the reader export marks such issues private by default.

## Build order (magazine-specific, assumes 04/06/07/08 primitives)

0. Source connectors (markdown folder first, Zotero second) + issue recipe from items + `recurring`. — M

1. Page-folder data model + migrate publication runner output into it. — M
2. Section map + world **+ kit** casting stage; Section board UI (section = unit of approval, §4b). — M
3. Page-bundle authoring prompt (content+spec+briefs in one turn) using `quire-magazine-page` + the writing bar; `magazine-readability` audit pack. — M
4. Per-page re-run endpoints (rewrite / redesign / re-world / regenerate-art). — M
5. `scorePage` (design-skill §12b) on spec + render.png + asset meta; cause-routed auto-redesign ≤ 2×; `score.json`. — M
6. Beauty-gate flipbook UI with the four verdicts. — M
7. Per-world taste accumulation. — L
