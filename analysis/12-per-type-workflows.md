# 12 — Per-Type Workflows: One Spine, Different Bodies

## The user's canonical flow (the spine)

```
Prompt → Content creation → Audit / Verify / Restyle / De-AI-fication
      → CONTENT APPROVAL (gate 1)
      → Design-system selection → DESIGN APPROVAL (gate 2)
      → Image generation (ComfyUI) → Final build (Affinity/EPUB) → BUILD APPROVAL (gate 3)
      → Reader
```

Key insight from the code: **this full spine exists only for `publication` (magazine).**
Books have gates 1 (chapter approval) but no design/build stages. Shorts/storyboards
generate images but never reach a designed artifact. The registry
(`productions/registry.js`) declares capabilities (`images`, `factCheck`, `auditable`)
but not *stages* — so nothing outside the publication runner can reason about the spine.

Also verified in code, and important: **de-AI-fication already half-exists** —
`pipeline/detection-runner.js` produces the `detectionScore` on `ChapterMeta`, and
`publication-voice.js`/`voice-claims.js` handle voice enforcement. It's a score today,
not a fix-it stage. The plan below makes "restyle + de-AI pass" a real, reusable stage.

## Stage capability matrix (current → target)

Legend: ✅ exists · 🟡 partial · ➕ add · — not applicable

| Stage | Book/Novel | Storybook* | Short | Script | Storyboard | Interactive film | Magazine (publication) | Play | Translation |
|---|---|---|---|---|---|---|---|---|---|
| Intake (structured prompt) | 🟡 architect chat → ➕ intake fields | ➕ | 🟡 | 🟡 | 🟡 | 🟡 | ✅ `intake[]` in definition | 🟡 | 🟡 |
| Research / fact-check | — | — | — | — | — | — | ✅ research→fact-check | — | — |
| Plan (outline / flatplan) | ✅ outline + truth files | ➕ page-beat plan | 🟡 | ✅ | ✅ | ✅ | ✅ plan (archetypes, densities, pillars) | — | ✅ chunking |
| Write | ✅ writer per chapter | ➕ per page-spread | ✅ | ✅ | ✅ | ✅ | ✅ per page | ✅ live | ✅ |
| Audit | ✅ auditor | ➕ | ✅ | ✅ | ✅ | ✅ | ✅ | — | ✅ |
| Restyle / de-AI pass | 🟡 detectionScore only → ➕ reviser mode | ➕ | 🟡 | 🟡 | 🟡 | 🟡 | 🟡 voice-claims → ➕ | — | 🟡 |
| **Gate 1: content approval** | ✅ per chapter | ➕ per page | ✅ | ✅ | ✅ | ✅ | ✅ `approved` + copy gate | — | ✅ |
| Design-system (world) selection | ➕ (surface: book) | ➕ (surface: storybook) | ➕ (cover+plates) | — | ➕ (frame style) | ➕ | 🟡 `prompts.design` → ➕ worlds per section | — | inherit source |
| **Gate 2: design approval** | ➕ | ➕ | ➕ | — | ➕ | ➕ | ✅ `designApproved` | — | — |
| Image generation | 🟡 cover only | ➕ every spread | ✅ | — | ✅ panels | ✅ | ✅ art stage | 🟡 run images | — |
| Layout/build | 🟡 EPUB only → ➕ print PDF via Affinity/Typst | ➕ Affinity picture-book build | ➕ single-plate build | ➕ screenplay PDF (Typst, not Affinity) | ➕ panel-sheet PDF | — (HTML) | ✅ Affinity PDF | — | ✅ EPUB |
| **Gate 3: build approval** | ➕ | ➕ | ➕ | ➕ | ➕ | — | ✅ build gate | — | ➕ |
| Reader | ➕ reflow (epub.js) | ➕ flipbook | ➕ | ➕ | ➕ | ✅ own player | ➕ flipbook | ✅ live | ➕ |

\* Storybook does not exist as a type today — it's the clearest new definition to add
(see below).

## The architectural move: extend the registry into a stage graph

Right now each production wires its own runner (`runner.js`, `short-fiction-runner.js`,
`script-storyboard-runner.js`, `publication-runner.js`). Don't merge the runners —
instead give the registry a declared **stage list per type** so the UI, gates, job
queue (03), and audit screens can treat every type uniformly:

```js
// productions/registry.js (extended)
{ id: "book", stages: ["intake","plan","write","audit","destyle",
                       "gate:content","design","gate:design","art","build","gate:build"],
  surfaces: { design: "book", build: ["epub","print-pdf"] }, ... }
```

- Each stage id maps to an existing module where one exists (`publication-research.js`,
  `story-audit.js`, `detection-runner.js`, `publication-design.js`, `storyboard-art.js`)
  — this is wiring, not rewriting.
- The Studio UI renders **one universal pipeline stepper** (02) from the stage list;
  gates become uniform chips on every production card, not magazine-only.
- A stage a type doesn't declare simply doesn't render. That's how "each type does not
  have the same workflow" and "one consistent UX" coexist.

## Per-type work plans (what to actually build)

### Book / Novel
1. **Intake fields** for book creation (genre, style packs from 05, target extent,
   world with `surface: book`) instead of free chat only.
2. **Destyle stage**: reviser mode driven by detectionScore + humanizer-style rules
   (ban stock AI patterns); runs after audit, before approval; per-chapter.
3. **Design stage (small)**: world choice fixes trim size, type scale, chapter-opener
   ornament, running heads → generates a book template spec.
4. **Print build**: chapters → Typst (default, cross-platform) or Affinity book
   template (07) → PDF alongside the existing EPUB. Gate 3 on the rendered PDF.

### Storybook (new definition — highest-value addition)
The definition system was built for exactly this: a **picture-book publication type**,
not a book variant. `storybook.json` definition: extent 24–48, archetypes
(`plate-full-bleed`, `text-facing-plate`, `spot-spread`, `title`, `endpaper`), densities
tiny (30–80 words/page), rules (`evenExtent`, plate on recto), intake (age band,
character sheet, moral/theme), `needsImages: true`, `needsPdf: true`.
- Content and image are **co-planned per spread**: the page prompt asks for text AND an
  illustration brief AND the character's pose/emotion (recurring-cast consistency via
  character reference images + IPAdapter workflow, 09).
- One world for the whole book (children's books need visual constancy — opposite of
  magazine).

### Short
Add a "plate build": one designed A3/A4 sheet or 4–8 page mini-zine via a tiny
publication definition. Shorts currently produce text+images that go nowhere.

### Script
No images, no Affinity. Add a **screenplay formatter** (Fountain → PDF via Typst
template — industry-standard margins). Gate 3 = formatted PDF.

### Storyboard
Panels already generate. Add: panel-sheet layout (6-up grid PDF), per-panel image
recipes (04) so a panel can be regenerated in the same style, and camera/shot metadata
in the sidecar.

### Interactive film / Play
Leave builds alone (they're runtime experiences), but adopt: sidecar recipes for run
images, and the universal stepper for creation stages.

### Translation
Inherits the source book's design entirely; only add gate 3 (EPUB check) and the
destyle stage (translations are where AI-flavored prose shows most).

### Magazine
Gets its own full plan — see `13-magazine-master-plan.md`.

## Build order

1. Registry stage lists + universal stepper UI (pure metadata + UI). — M
2. Destyle stage as a shared module (detection-runner + rules) wired into book, short,
   translation, publication. — M
3. Storybook definition JSON + character-consistency workflow. — M
4. Book print build (Typst first, Affinity template later). — M
5. Script/storyboard/short builders (all Typst-class, no Affinity needed). — M
6. Uniform gate chips + approvals API for all types. — S (after 1)
