# Carousel Brief — Format Spec + Future carousel-gen Skill

Two stages:
1. **Now (v1):** ebook-weaver Step 7 writes `CAROUSEL.md` — a complete content brief consumable by the installed `social-media-carousel` skill (`inferen-sh/skills`, 7-slide framework, HTML→image).
2. **Later (v2):** own `carousel-gen` skill that renders the slides itself.

## v1 — CAROUSEL.md format

Written into the topic folder by ebook-weaver.

```markdown
---
book: "[[BOOK.md]]"
platform: instagram          # 1080x1350 portrait default
slides: 7
theme: <2-4 word visual theme, e.g. "aged parchment & ink">
palette: [<bg hex>, <text hex>, <accent hex>]
typography: <direction, e.g. "serif display headline + clean sans body">
---

# Carousel: <book title>

## Overall direction
<3-5 lines: mood, visual motif carried across slides, how it echoes the book cover>

## Slide 1 — HOOK
- Text: <≤12 words, the scroll-stopper — boldest question/claim from the book>
- Visual: <direction; may reference an _assets/ image>

## Slides 2–6 — STORY / CURIOSITY
(one block per slide)
- Text: <≤25 words; each slide = one open loop from the book's arc, in order:
  origins → idea → creation → modern ripple → philosophical tension>
- Visual: <direction>

## Slide 7 — CTA
- Text: <invite: read "<catchy book title>"; echo one closing question>
- Visual: <cover-like treatment>

## Caption
<150-200 word Instagram caption: hook line, 2-3 line tease, question to comments, CTA>

## Hashtags
<10-15, mix broad + niche>
```

Rules:
- All slide facts must exist in `_research/fact-check.md` as verified/single-source.
- Slide texts are self-standing (readable without caption) and sequential (each pulls to swipe).
- Theme/palette should harmonize with the book's imagery in `_assets/`.

## Using it with social-media-carousel (interim workflow)

1. Install once, globally: `npx -y skills add inferen-sh/skills --skill social-media-carousel --agent claude-code`
2. Invoke that skill pointing at `CAROUSEL.md` — it maps directly onto its 7-slide structural framework (hook slide, text hierarchy, engagement psychology) and renders images via HTML-to-image.
3. Rendered images land next to the topic folder (or wherever that skill outputs); move into `_assets/carousel/` for vault tidiness.

## v2 — carousel-gen skill (future, planned only)

- **Trigger:** `/carousel-gen <topic-folder>` — reads `CAROUSEL.md`, renders final slide images without external skill.
- **Rendering:** one HTML template per slide role (hook / story / CTA), themed via CSS variables fed from the brief's `palette`/`typography`; screenshot at 1080×1350 via the in-app browser (preview + screenshot workflow) or a headless renderer.
- **Templates:** vault-branded slide templates kept in the skill folder (`templates/`), so every book's carousel shares a recognizable identity while palette varies per book.
- **Outputs:** `_assets/carousel/slide-01.png … slide-07.png` + `caption.txt`.
- **Platform variants:** `--platform linkedin|x` adjusts dimensions + text density.
- Build only after v1 workflow proves out on 2–3 real books.
