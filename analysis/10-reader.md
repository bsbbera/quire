# 10 — Reader: A Real-Book Reading UI

## Goal

A polished, book-style reading surface for finished output — page spreads, page-turn,
zoom — like the OYLA site's demo flipbook. Today Quire produces PDFs/EPUBs but offers
no way to *experience* them; the product ends at a file. The Reader closes the loop
and doubles as the share/preview surface.

## What to build on (open source, as the user noted)

| Layer | Library | Why |
|---|---|---|
| PDF rendering | **PDF.js** (Mozilla, Apache-2.0) | The standard; renders the Affinity PDF pixel-perfect to canvas |
| Flipbook | **StPageFlip / page-flip** (MIT) — or `dflip`-style wrappers around it | Realistic soft/hard page-turn physics, spread mode, works with canvas images; this is what most OYLA-like demos use under the hood |
| EPUB (novels) | **epub.js** (BSD) | Reflowable text for books; pagination, themes, CFI locations |
| Alternative | flipbook-vue / react-pageflip | Same engine, framework wrappers |

Two modes, one shell:

- **Fixed-layout mode** (magazines, storybooks): PDF.js rasterizes each page →
  StPageFlip presents spreads with turn animation, pinch/scroll zoom, thumbnail strip.
- **Reflow mode** (novels): epub.js with the world's type scale as the default theme
  (serif body, correct measure), user-adjustable size/margins/dark mode.

## Integration plan

1. **Source of truth:** `Magazine/issues/<id>/build/*.pdf` and the EPUB exporter output.
   Reader route in Studio: `/read/:productionType/:id`.
2. **Pre-rasterize on build:** at PDF export time, also emit `build/pages/*.webp`
   (2 sizes: thumb + 2× read). PDF.js can do it lazily in-browser, but pre-rendering
   makes first-open instant and enables the library shelf thumbnails.
3. **Shelf:** a "Library" home listing finished productions as book covers (cover image
   from `covers/` / issue cover page) — this becomes the app's most attractive screen.
4. **Reader chrome:** minimal — center stage, arrow/edge-drag page turn, spread/single
   toggle, zoom, TOC (from flatplan/chapter index), progress bar. Keyboard + touch.
   Respect `prefers-reduced-motion` (fade instead of flip).
5. **Review overlay (bonus, big win):** in draft mode, the Reader *is* the page-review
   surface from 06 — same flipbook with keep/redo/tweak buttons per page. One component,
   two uses (review before approval, reading after build).
6. **Share/export:** "Export web reader" — a static folder (HTML + webp pages + the
   flip lib) the user can host anywhere; magazines become shareable links. Later: this
   is exactly the artifact a mobile/tablet app consumes (11).

## Effort

Small relative to payoff: PDF.js + StPageFlip integration is days, not weeks; the
pre-raster step is a build hook; the shelf is a grid over existing data. Ship it early —
it's the screen every demo, screenshot, and buyer decision will rest on.
