# blog-spark — Skill Spec

SEO teaser blog for an ebook-weaver topic. **Single purpose:** create curiosity so readers go read the ebook. Never a summary, never resolves the questions it raises.

## SKILL.md frontmatter

```yaml
---
name: blog-spark
description: Write an SEO-optimized teaser blog for an ebook-weaver topic — opens curiosity loops, teases 2-3 cited facts, drives readers to the ebook. Trigger: /blog-spark "<topic>" or /blog-spark <topic-folder-path>.
trigger: /blog-spark
---
```

## Invocation forms

```
/blog-spark "<topic>"                    # standalone: light research, then write
/blog-spark <path-to-topic-folder>       # from ebook-weaver: reuse _research/, link BOOK.md
```

Resolution: if arg is an existing folder containing `BOOK.md` → book mode; else treat as topic string, check `<default-vault>/<slug>/` first, fall back to standalone.

## Output

`BLOG.md` inside the topic folder (standalone mode creates the topic folder + minimal `_research/` first).

### Frontmatter

```yaml
---
title: <≤60 chars, keyword included>
description: <meta description, ≤155 chars, curiosity hook>
slug: <kebab-case>
keywords: [primary, secondary, secondary]
date: <YYYY-MM-DD>
book: "[[BOOK.md]]"
---
```

### Body structure (~1,200–1,800 words)

1. **Hook intro** (100–150 w) — open with the most surprising verified fact or a scene; primary keyword in first 100 words.
2. **3–4 H2 sections** — each built as an **open loop**: pose a question the ebook answers, tease the setup, withhold the payoff. One H2 contains the primary keyword.
3. **2–3 teased facts** with citations (footnotes to `_research/sources.md` entries in book mode) — establishes credibility.
4. **Question cluster** near the end — 3–5 direct questions to the reader (mirrors the ebook's closing-chapter questions, but unanswered).
5. **CTA** — explicit pointer to the ebook by its catchy title, internal wikilink to `[[BOOK.md]]`.

## SEO checklist (embed in SKILL.md, verify before finishing)

- [ ] Title ≤60 chars, keyword present, curiosity-framed (question or bold claim)
- [ ] Meta description ≤155 chars, ends with implicit question/tension
- [ ] Primary keyword: H1, first 100 words, ≥1 H2, naturally ~4–6× total (no stuffing)
- [ ] H1 → H2 → H3 hierarchy, no skipped levels
- [ ] 1 image (reuse strongest from `_assets/`) with keyword-bearing alt text
- [ ] Internal link to BOOK.md; external links only to cited sources
- [ ] Short paragraphs (≤3 sentences), scannable
- [ ] Reading level: easy (target ~grade 7–8)

## Anti-goals

- Do NOT summarize the book or resolve its questions — the blog sells the itch, the book scratches it.
- Do NOT introduce facts absent from the fact-check ledger (book mode).
- No clickbait that the ebook can't cash.
