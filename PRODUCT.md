# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

Static HTML + CSS, no build step. Animation: **GSAP + ScrollTrigger via CDN** (user's choice, 2026-08-04). Color and type come from `Books/website/design-system/tokens.css` — reference custom properties only, never raw hex. Current `Books/website/index.html` is a single self-contained file on that pattern.

## Users

A reader who arrives cold on the store landing page — from a social post, a teaser blog, or a link — knowing nothing about the imprint. They are deciding, in one scroll, whether this book is worth their attention. Four jobs are all in scope on the same page (confirmed):

1. read the book free in the browser,
2. download / buy the PDF,
3. join a list or follow,
4. simply be impressed enough to remember the imprint.

## Product Purpose

**Ideaverse Books** is a one-person imprint publishing short, researched, illustrated non-fiction volumes (~9–10k words, 15–25 composed pages). The store landing page is the front door: it presents the shelf and converts a stranger into a reader. Success = the visitor takes one of the four jobs above rather than bouncing.

## Positioning

Each volume is a **fully composed print-grade magazine**, not a markdown blob or a Medium post: chapters are laid out in Affinity Publisher, exported to PDF, then extracted back into an in-browser reader that reproduces the real spreads (text runs, images, vector paths, page-turn, page-number deep links, resume). Every volume also carries a sources ledger and a fact-check ledger. Short-form non-fiction with the production values of print, readable free in the browser.

## Operating Context

Book production pipeline that exists today:

```
topic → ebook-weaver skill → chapter markdown + _research/ (sources, fact-check)
      → Affinity Publisher layout (.afpub) → PDF
      → extraction pipeline → in-browser reader
```

Each book folder also ships companion marketing artifacts: `BLOG.md` (teaser blog) and `CAROUSEL.md` (Instagram carousel brief). `Books/_design/` holds the Affinity toolkit and layout plan.

## Capabilities and Constraints

- Five book folders exist under `Books/`: `leonardo-da-vinci`, `women-empowerment`, `feminism-as-capitalist-movement`, `feminism-vs-women-empowerment`, `the-secret-of-universe-around-3-6-9`.
- **Only `leonardo-da-vinci` is composed** — it alone has `.afpub` + `leonardo-layout.pdf`. The rest are markdown + research only. Volume count on the page must reflect this truth, not five finished books.
- The landing page is **one page for the whole store**, not one page per title (confirmed 2026-08-04). No per-book template is in scope.
- **Undecided — do not invent:** checkout mechanism, price, currency, licensing, email-list provider, deploy target. This build is *interface only*; commerce CTAs are placeholders with no live destination and must not be presented as working.
- No commit, push, or deploy without asking.

## Brand Commitments

- Name: **Ideaverse Books** (imprint byline; no personal author name on the page).
- Binding visual authority: `Books/website/design-system/DESIGN.md` + `tokens.css` — "Soft Orbit rev 2 · Fjord & Field". Fjord scale spine, one muted field per section, ember as footnote, hairlines not shadows, light + dark both ship.
- Motion character established across prior rounds: calm hands — long decelerating moves, one ease family, no bounce, sequential choreography, full `prefers-reduced-motion` path.

## Evidence on Hand

- Real, finished manuscripts with word counts and chapter tables: `Books/<slug>/BOOK.md`.
- One composed magazine: `Books/leonardo-da-vinci/leonardo-layout.pdf` (~24 pages, 8 images, 9,436 words).
- Research provenance per book: `_research/sources.md`, `_research/fact-check.md`.
- Design system + living style guide: `Books/website/design-system/`.
- Visual references the user pinned: `Books/website/reference/` (ref1–4, Color1–3), `.tmp-pins/`.
- Prior plans and their verdicts: `Books/website/plans/`.
- **Absent — never fabricate:** sales figures, reviews, testimonials, press quotes, reader counts, awards, ISBNs, launch dates.

## Product Principles

1. **The book is the hero.** Real covers, real spreads, real page counts — the artifact does the persuading, not adjectives about it.
2. **Never overstate the shelf.** One volume is composed; the page must be honest about what is readable today and what is coming.
3. **Print values on the web.** Anything shipped should look composed, not templated — that claim is the positioning, so the page must itself prove it.
4. **Motion is choreography, not decoration.** Advanced ≠ fast; every move earns its place and degrades cleanly.
5. **Truth over conversion.** No invented proof, no fake checkout, no claim the pipeline can't back.

## Accessibility & Inclusion

Project standard carried forward from prior phase gates: body-text contrast ≥ 4.5:1 in **both** light and dark themes, full `prefers-reduced-motion` path, Lighthouse a11y ≥ 95, viewport sweep at 1920 / 1440 / 1000 / 430.
