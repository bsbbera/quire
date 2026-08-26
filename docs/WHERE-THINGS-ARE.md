# Where things are

`IDEAVERSE` is three unrelated projects sharing one directory, plus the working
data of two of them, plus about four gigabytes of build cache. That is why it
reads as a mess: nothing is broken, but nothing says which of the three it
belongs to. This file says.

---

## The three projects

### 1. Quire — the desktop app

The only one this repository actually versions.

| Path | What |
|---|---|
| `desktop/` | Tauri shell, the Rust side, the app UI |
| `cli-shim/` | The Node backend: model shim, MCP discovery, ComfyUI, Affinity |
| `vendor/inkos` | The InkOS fork, as a git submodule. **Source of truth for the engine.** |
| `cli-shim/inkos/` | Build output — `vendor/inkos` staged for the app. Ignored, regenerated. |
| `quire.mjs` | Launcher: starts the shim, then Studio |
| `docs/QUIRE-PLAN.md` | The plan being worked. Phases 1-7 done, 8 open. |
| `docs/DEBT.md` | Everything skipped, stubbed or unverified |
| `README.md` | What Quire is, how to run it, the licence question |

**The one rule that catches everyone:** editing `vendor/inkos` changes nothing
until `node desktop/vendor-inkos.mjs` stages it. Stop the app first — Windows
will not overwrite a file it still holds open.

### 2. Ideaverse skills — the authoring skills

`/ebook-weaver`, `/blog-spark`, `/mag-content`, `/mag-design`, `/cookbook` and
the rest.

| Path | What |
|---|---|
| `ideaverse-skills/` | **Its own git repository**, own GitHub remote. Not versioned here. |
| `docs/specs/*-spec.md` | The specs the skills were written from |
| `docs/specs/skills-plan.md` | Its plan. All five phases shipped. Was `PLAN.md` at the root. |
| `~/.claude/skills/` | Where they are actually installed and run from |

`sbinkos` is installed but **not in the repository** — it exists only in
`~/.claude/skills`. One disk failure from gone.

### 3. Ideaverse Books — the imprint and its store page

| Path | What |
|---|---|
| `PRODUCT.md` | Product context for the store landing page. Read by the `impeccable` skill, which expects it at the repo root — leave it there. |
| `site/` | The landing page, whole. Was `Books/website/`. Moved as a unit rather than split, because `index.html` links `design-system/tokens.css` and taking that apart breaks the page. |
| `design/` | Everything reference-and-method, gathered from the six places it used to be |
| `.impeccable/` | That skill's cache, shots and surface briefs. Ignored. |

`design/` replaced `UI-Vault/`, `Books/_design/`, `Books/Template ref/` and
`Magazine/Reference Image/`:

| Path | What |
|---|---|
| `design/systems/` | Seven design systems — Corsair Codex, Grimoire, Pirate Codex, mywiki, old-archive, digital-archaeology |
| `design/references/` | `book-ui/`, `shapeshifter/` (623 files), `layout-templates/`, `magazine-refs/`, `book-images/` |
| `design/prompts/` | bookvault, grantha, mywiki, theme-landing |
| `design/method/` | `LAYOUT-PLAN.md`, `affinity-toolkit.js`, `reference-layouts.md` |

**`Books/` is gone from this repository.** It held eight projects and 473 MB;
six of those were books, and they were deleted on 2026-08-26 at the owner's
instruction — 258 files, 420 MB, including four hand-composed Affinity
documents. What survived is `design/references/book-images/`: 64 images, 42.6
MB, filed under the book each came from. Nothing else of them exists anywhere.

Books now live only in the workspace, at `~/InkDesk/books/`, which is where the
app looks for them.

---

## The two workspaces, and why the magazine looks duplicated

Quire is an InkOS workspace application, and there are two workspaces on this
machine. Both have an `inkos.json`, both have `Magazine/` and books.

| | `C:\Users\SUBHADIP\IDEAVERSE` | `C:\Users\SUBHADIP\InkDesk` |
|---|---|---|
| Role | the source repo, and an **old** workspace | the **live** workspace |
| Magazine format | `issue.json` — pre-Quire | `publication.json` — current |
| The film issue | 16 pages, last written 2026-08-22 | same issue, last written 2026-08-25 |
| Second issue | — | `indian-culture-everyday-rituals` |
| Books | 8 projects | 1 (`the-cartographer-of-vanishing-`) |

**The app runs against `InkDesk`, and it can never run against this repo.**
The workspace is not the working directory — every entry point resolves it the
same way (`cli-shim/studio.mjs:25`, and the same four lines in `server.mjs`,
`workflows.mjs`, `mcp-server.mjs`, `migrate-magazine.mjs`):

```js
process.env.QUIRE_WORKSPACE
  || [join(homedir(), "Quire"), join(homedir(), "InkDesk")].find(existsSync)
  || join(homedir(), "Quire")
```

`~/Quire` does not exist, so `~/InkDesk` wins. `IDEAVERSE/inkos.json` is never
read by anything — it is a leftover of when this directory *was* the workspace.

**The trap in those four lines:** anything that creates `~/Quire` — including a
first run on a machine where `~/InkDesk` is missing — silently moves the app to
an empty workspace, and every book and issue appears to have vanished. Set
`QUIRE_WORKSPACE` if you ever want to be sure which one you are on.

`IDEAVERSE/Magazine` is the state the magazine was in before the format
migration (`cli-shim/migrate-magazine.mjs`); the live copy has moved on by three
days of audit and revise work.

`IDEAVERSE/Books` is the opposite case — eight projects the live workspace does
**not** have. That is real work, not a stale copy.

There is a third `InkDesk` at `OneDrive\Desktop\InkDesk`. It is not a workspace:
it is where Affinity writes its build output — one `.afpub`, its assets, the PDF.
The name is the only thing confusing about it.

---

## What is large, and whether it matters

| Size | Path | Regenerable? |
|---:|---|---|
| 3.0 GB | `desktop/src-tauri/target` | Yes — Rust build cache. Deleting costs one long rebuild. |
| 498 MB | `vendor/` | Yes — submodule plus its `node_modules` |
| 448 MB | `Magazine/` | Superseded by InkDesk. Still to decide. |
| 198 MB | `.window-profile/` | Yes — a Chromium profile the agent tooling made |
| 103 MB | `design/` | **No.** References, systems, prompts, method. |
| 102 MB | `cli-shim/inkos/` | Yes — one `vendor-inkos.mjs` away |
| 52 MB | `site/` | **No.** The store landing page. |
| 34 MB | `.git` | — |
| 586 KB | `_backups/20260823-163914` | Yes — a snapshot of `cli-shim` that git already holds |

`Magazine/` is not purely stale: `EDITORIAL-METHOD.md` and `_archive/` exist
nowhere else. Its `Reference Image/` has already moved to
`design/references/magazine-refs/`.

---

## The six work types

Quire is not one pipeline. Each work type has its own folder in the workspace
and its own runner, and only one of them is definition-driven.

| Folder | What | Runner |
|---|---|---|
| `books/` | Novels and serials — `book.json`, `chapters/`, `story/` | `pipeline/runner.ts`, 3,882 lines |
| `shorts/` | Short fiction — `outline/`, `drafts/`, `reviews/`, `final/` | `short-fiction-runner.ts`, 1,216 |
| `Magazine/` | Publications — `issues/<id>/publication.json` | `publication-runner.ts`, 1,464 |
| `interactive-films/` | Interactive film, story tree, storyboard | `script-storyboard-runner.ts`, 765 |
| `worlds/` | Open-world play — `runs/`, state, projections | `play_start` / `step` / `edit` / `revise` |
| `covers/`, `prompt/` | Supporting output | — |

**Only `Magazine` is definition-driven.** Its type is a JSON file in
`publications/`, so a new publication type is a file you drop in a folder
rather than a release. The other four are hand-written runners.

That distinction decides where new work belongs. A short illustrated book — a
cover, six to nine chapters of 600-900 words, an image per chapter — is not
what `runner.ts` is for: `BookConfigSchema` defaults to 200 chapters and
`chapterWordCount` has `min(1000)`, so it would reject a 900-word chapter
outright. The publication vocabulary (archetypes, densities, extent, furniture)
fits that shape exactly. `publications/book.json` is the missing piece, and is
not written yet.

`~/InkDesk` now has all six folders; `interactive-films/`, `covers/` and
`publications/` were created on 2026-08-26.

---

## Small duplicates

- `.agents/skills` and `.claude/skills` hold the same `social-media-carousel`,
  byte for byte. Both ignored.
- `docs/specs/archive/quire-plan-v1.md` is the superseded first Quire plan. It used
  to be `docs/specs/quire-plan.md` — two files called "quire plan" with different
  phase numbering, which is how a plan stops being a plan.
