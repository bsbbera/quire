# ebook-weaver — Skill Spec

Topic string → researched, cited, storytelling ebook (chapter-wise .md) inside an Obsidian vault, then triggers blog-spark and emits a carousel brief.

## SKILL.md frontmatter (graphify style)

```yaml
---
name: ebook-weaver
description: Turn any topic into a 15-20 page storytelling ebook inside an Obsidian vault — researched, fact-checked, cited, chapter-wise .md files with images — then trigger the blog-spark teaser blog and emit an Instagram carousel brief. Trigger: /ebook-weaver "<topic>".
trigger: /ebook-weaver
---
```

## Invocation forms

```
/ebook-weaver "<topic>"
/ebook-weaver "<topic>" --vault <path>
/ebook-weaver "<topic>" --pages 18
/ebook-weaver "<topic>" --sources file1.pdf notes.md https://example.com/article
/ebook-weaver "<topic>" --update          # rerun on existing topic folder, ingest RAW/
/ebook-weaver "<topic>" --no-blog --no-carousel
```

- **Mandatory:** topic (string).
- **Optional:** `--vault` (default: config at top of SKILL.md, editable once vault is decided), `--pages` (default 15–20 band), `--sources` (PDFs, .md, URLs), `--update`, `--no-blog`, `--no-carousel`.

## Folder structure created

```
<vault>/<topic-slug>/
├── BOOK.md
├── 00-cover.md
├── 01-<chapter-slug>.md … NN-<chapter-slug>.md
├── _research/
│   ├── RAW/
│   ├── sources.md
│   ├── findings/
│   │   └── <source-slug>.md      # one note per ingested source
│   └── fact-check.md
└── _assets/
```

`RAW/` is created empty on first run — it is the drop-box for future material; `--update` reruns ingest it.

## Pipeline

### Step 1 — Setup
- Slugify topic (kebab-case). If `<vault>/<slug>/` exists and no `--update`: stop, tell user, suggest `--update`.
- Create the full structure above.
- Initialize `BOOK.md` with status `researching` and empty run log.

### Step 2 — Research
Order of sources:
1. `--sources` inputs + anything already in `_research/RAW/`.
   - PDFs: extract with `pdftotext` (poppler is NOT installed on this machine — do not try `pdfplumber` route first).
   - URLs: WebFetch.
   - .md/.txt: read directly.
2. Web research: WebSearch/WebFetch. If brave-search / firecrawl / other search MCP tools are available in the session, use them too.
3. Own knowledge — allowed for narrative color, but any *fact* stated must be checked against at least one external source.

Outputs:
- `_research/findings/<source-slug>.md` per source: key facts, quotes (short, attributed), dates, anecdotes — each line tagged `[S<n>]`.
- `_research/sources.md` — numbered ledger:
  ```
  ## S1 — <title>
  - URL/file:
  - Accessed: <date>
  - Type: primary / secondary / tertiary
  - Reliability: high / medium / low + one-line reason
  ```
- `_research/fact-check.md` — table: `| claim | sources | verdict |` with verdict ∈ verified (≥2 independent sources) / single-source / disputed / unverified. Book text may only assert "verified" and "single-source" claims; single-source claims get hedged phrasing ("according to …").

### Step 3 — Outline
- Generate **3 catchy title candidates** (evocative, not descriptive — model: "He Who Knew Everything" for da Vinci). Pick the strongest; record all 3 in BOOK.md.
- Build chapter outline on the **fixed narrative arc**:
  1. Hook / origins & childhood
  2. How the ideas formed (influences, turning points)
  3. The creations / core work (may span 2–3 chapters for rich topics)
  4. The journey — struggles, failures, rivalries
  5. Ripple to the modern world (concrete modern applications, named)
  6. Philosophical discussion (what the story means; tensions, paradoxes)
  7. Closing — direct open questions to the reader (curiosity, no answers)
- 6–9 chapters total. Non-person topics (e.g. "cryptography") map the same arc: origin story → key minds → breakthroughs → struggles → modern life → philosophy → questions.

### Step 4 — Write chapters
- **Page math:** 1 page ≈ 300–350 words including image space → target = pages × ~325. Default 15–20 pages ⇒ 5,000–7,000 words ⇒ 600–900 words/chapter.
- **Voice rules** (embed verbatim in SKILL.md):
  - Storytelling: scenes, tension, sensory detail; open each chapter mid-action or with a question.
  - Human & easy: short sentences, no jargon without a one-line unpacking, second person allowed ("imagine you are…").
  - Curiosity engine: each chapter ends with a forward pull (unresolved thread the next chapter picks up).
- **Citations:** Obsidian footnotes `[^1]` inline; footnote definitions at chapter bottom pointing to ledger: `[^1]: [[_research/sources|S3]] — <short cite>`. Every fact-check "verified/single-source" claim used gets one.
- **Cross-links:** chapters wikilink each other and BOOK.md; `00-cover.md` = chosen title, subtitle, 1-para hook, `![[cover image]]` if found.
- Update BOOK.md TOC with wikilinks + per-chapter word counts as you go.

### Step 5 — Images
- 1–2 per chapter. Search order: Wikimedia Commons → other public-domain/CC sources found via web search.
- Download into `_assets/` with descriptive kebab-case filenames. Embed:
  ```
  ![[_assets/vitruvian-man.jpg]]
  *Vitruvian Man, c. 1490 — source: Wikimedia Commons (public domain)*
  ```
- License check: only public-domain / CC-BY / CC-BY-SA; record license in the caption.
- Nothing suitable → placeholder callout:
  ```
  > [!image-placeholder] Young Leonardo sketching in Verrocchio's workshop
  > Suggested search: "Verrocchio workshop painting public domain"
  ```

### Step 6 — Trigger blog-spark
- Unless `--no-blog`: invoke the blog-spark skill with the topic folder path (it reuses `_research/`, writes `BLOG.md`). See blog-spark-spec.md.

### Step 7 — Carousel brief
- Unless `--no-carousel`: write `CAROUSEL.md` per carousel-brief-spec.md (theme + 7 slides + visual direction).
- If the `social-media-carousel` skill is installed, offer to invoke it on the brief (don't auto-run — image generation costs a run).

### Step 8 — Report
Final message to user: chosen title (+ rejected candidates), chapter list with word counts, total-pages estimate, count of verified vs single-source facts, list of unverified claims *excluded*, image attributions, placeholder count, whether blog + carousel brief were produced.

## --update mode

1. Scan `_research/RAW/` for files newer than last run (run log in BOOK.md stores timestamp).
2. Extract → new `findings/` notes, extend `sources.md` + `fact-check.md`.
3. Diff against chapters: revise only affected chapters; note revisions in run log.
4. Re-run Steps 6–7 only if chapters materially changed.

## Non-goals (v1)

- No EPUB/PDF export (Obsidian .md is the format; export later if wanted).
- No automatic publishing anywhere.
- Carousel *rendering* belongs to future carousel-gen skill.
