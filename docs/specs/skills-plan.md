> **Done, and about a different project from Quire.**
>
> This is the plan for the Ideaverse *skills* — ebook-weaver, blog-spark and the
> carousel brief. All five of its phases shipped: the skills live in
> [`ideaverse-skills/`](../../ideaverse-skills), which is its own repository with
> its own GitHub remote, and they are installed globally. The line below saying
> "everything in IDEAVERSE is plan-only" was true when it was written and has
> not been for months.
>
> It sat at the repo root as `PLAN.md`, next to Quire's plan, which is why it
> read as Quire's. Its specs were already in this directory; now so is it.

# IDEAVERSE — Ebook + Blog + Carousel Skill System

Master plan. Detailed specs live in [this directory](.).

## Goal

One command turns any topic string into a publishing pipeline inside an Obsidian vault:

```
/ebook-weaver "Leonardo da Vinci"
        │
        ├─ 1. Research (web + optional PDFs/mds/links + RAW/ folder) → cited database
        ├─ 2. Write 15–20 page storytelling ebook, chapter-wise .md files
        ├─ 3. Trigger /blog-spark  → SEO teaser blog (BLOG.md)
        └─ 4. Emit CAROUSEL.md brief → consumed by social-media-carousel skill
```

All skills globally installed, distributed from one GitHub monorepo, installable via
`npx -y skills add <owner>/ideaverse-skills --skill <name> --agent claude-code`.

## The three skills

| Skill | Status | Purpose | Spec |
|---|---|---|---|
| **ebook-weaver** | to build | topic → researched, cited, storytelling ebook in vault | [ebook-weaver-spec.md](ebook-weaver-spec.md) |
| **blog-spark** | to build | topic/book → SEO blog whose only job is driving readers to the ebook | [blog-spark-spec.md](blog-spark-spec.md) |
| **carousel-gen** | future | render Instagram carousel slides; interim = brief for `inferen-sh` skill | [carousel-brief-spec.md](carousel-brief-spec.md) |

Distribution + install: [distribution-spec.md](distribution-spec.md).

## The editorial formula (fixed, every topic)

1. **Narrative arc** — history → present: origins/childhood → how the ideas formed → the creations → journey/struggles → effect on the modern world → philosophical discussion → closing questions to the reader.
2. **Voice** — storytelling, human, easy language, curiosity-first. Never encyclopedia tone.
3. **Title** — catchy, evocative (e.g. *"He Who Knew Everything"*), 3 candidates generated, best chosen.
4. **Facts** — every claim traces to a source ledger entry; fact-check verdicts recorded.
5. **Length** — 15–20 pages (flexible); 1 page ≈ 300–350 words incl. images; 6–9 chapters of 600–900 words.
6. **Images** — 1–2 per chapter, real public-domain/CC downloads with attribution; placeholder callout as fallback.

## Vault layout per topic

```
<vault>/<topic-slug>/
├── BOOK.md            # manifest: title, status, TOC, word counts, run log
├── 00-cover.md
├── 01-… NN-…          # chapters
├── BLOG.md            # from blog-spark
├── CAROUSEL.md        # carousel brief
├── _research/
│   ├── RAW/           # drop new material here, rerun with --update
│   ├── sources.md     # numbered source ledger
│   ├── findings/      # per-source extracted notes
│   └── fact-check.md  # claim → source → verdict
└── _assets/           # downloaded images
```

Vault path = skill input (`--vault`); default configurable. Final vault location deferred — for now everything in IDEAVERSE is plan-only.

## Execution phases (each gated on go-ahead)

1. ✅ **This session** — plan + specs written to `IDEAVERSE/`
2. Author `skills/ebook-weaver/SKILL.md` + `skills/blog-spark/SKILL.md` in local monorepo clone
3. Global install: symlink into `~/.claude/skills/` + trigger lines in `~/.claude/CLAUDE.md`; install carousel skill: `npx -y skills add inferen-sh/skills --skill social-media-carousel --agent claude-code`
4. Test run `/ebook-weaver "Leonardo da Vinci"` end-to-end; verify in Obsidian
5. Create GitHub repo, push, verify clean `npx skills add` install (ask before push)
