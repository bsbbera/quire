# Distribution Spec — ideaverse-skills monorepo

One GitHub repo holds all skills; each installable individually via the `skills` npx CLI (same tooling as `inferen-sh/skills`, which reads the `skills/<name>/SKILL.md` layout).

## Repo layout

```
ideaverse-skills/                 # local clone lives at %USERPROFILE%\IDEAVERSE\ideaverse-skills\
├── README.md                     # what each skill does + install commands
├── LICENSE
└── skills/
    ├── ebook-weaver/
    │   └── SKILL.md              # self-contained (graphify style); templates inline
    ├── blog-spark/
    │   └── SKILL.md
    └── carousel-gen/             # added in v2; may carry templates/ subfolder
```

Repo name: `ideaverse-skills` under the user's GitHub account (account has `bsbbera` — confirm at repo-creation time).

## Install commands (README content)

Any machine / any project:

```
npx -y skills add <owner>/ideaverse-skills --skill ebook-weaver --agent claude-code
npx -y skills add <owner>/ideaverse-skills --skill blog-spark --agent claude-code
```

Companion (third-party, interim carousel rendering):

```
npx -y skills add inferen-sh/skills --skill social-media-carousel --agent claude-code
```

Note: `npx skills add` installs into the **project's** `.claude/skills/`. Global availability on this machine uses the symlink pattern below instead.

## Global install on this machine (matches existing setup)

Most entries in `%USERPROFILE%\.claude\skills\` are already symlinks into a store. For our skills, symlink straight to the repo clone so edits are live:

```
New-Item -ItemType SymbolicLink -Path "$env:USERPROFILE\.claude\skills\ebook-weaver" -Target "%USERPROFILE%\IDEAVERSE\ideaverse-skills\skills\ebook-weaver"
New-Item -ItemType SymbolicLink -Path "$env:USERPROFILE\.claude\skills\blog-spark"  -Target "%USERPROFILE%\IDEAVERSE\ideaverse-skills\skills\blog-spark"
```

Then add trigger lines to `~/.claude/CLAUDE.md` (graphify pattern):

```
# ebook-weaver
- **ebook-weaver** (`~/.claude/skills/ebook-weaver/SKILL.md`) - topic → storytelling ebook in Obsidian vault. Trigger: `/ebook-weaver`
When the user types `/ebook-weaver`, invoke the Skill tool with `skill: "ebook-weaver"` before doing anything else.

# blog-spark
- **blog-spark** (`~/.claude/skills/blog-spark/SKILL.md`) - SEO teaser blog for an ebook topic. Trigger: `/blog-spark`
When the user types `/blog-spark`, invoke the Skill tool with `skill: "blog-spark"` before doing anything else.
```

## Dev → release flow

1. Author/edit SKILL.md files in the local clone (`IDEAVERSE/ideaverse-skills/`).
2. Symlinks make them instantly live globally — test with `/ebook-weaver "Leonardo da Vinci"`.
3. Iterate until the Leonardo test run passes the checklist (below).
4. `git init`, commit locally. **Push/create GitHub repo only on explicit go-ahead** (standing preference: no auto-push; ask once at the end). No Claude co-author trailers.
5. After push: verify from a clean temp directory that `npx -y skills add <owner>/ideaverse-skills --skill ebook-weaver --agent claude-code` installs correctly.

## Test-run checklist (Leonardo da Vinci)

- [ ] Topic folder structure matches ebook-weaver spec exactly (incl. empty `_research/RAW/`)
- [ ] 6–9 chapters, 600–900 words each, total in 5,000–7,000 band
- [ ] Catchy title chosen; 3 candidates logged in BOOK.md
- [ ] Arc order holds: childhood → ideas → creations → journey → modern ripple → philosophy → reader questions
- [ ] Every stated fact has a footnote resolving to a `sources.md` entry; fact-check.md populated
- [ ] Images downloaded with license noted in caption; placeholders well-formed where none found
- [ ] BLOG.md passes the SEO checklist; links to BOOK.md; resolves nothing
- [ ] CAROUSEL.md matches brief format; feed it to social-media-carousel and confirm it renders
- [ ] Open vault in Obsidian: wikilinks, footnotes, embeds, callouts all render
- [ ] `--update` rerun after dropping a file in RAW/ revises only affected chapters
