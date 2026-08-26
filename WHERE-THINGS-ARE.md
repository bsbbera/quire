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
| `QUIRE-PLAN.md` | The plan being worked. Phases 1-7 done, 8 open. |
| `DEBT.md` | Everything skipped, stubbed or unverified |
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
| `specs/*-spec.md` | The specs the skills were written from |
| `specs/skills-plan.md` | Its plan. All five phases shipped. Was `PLAN.md` at the root. |
| `~/.claude/skills/` | Where they are actually installed and run from |

`sbinkos` is installed but **not in the repository** — it exists only in
`~/.claude/skills`. One disk failure from gone.

### 3. Ideaverse Books — the imprint and its store page

| Path | What |
|---|---|
| `PRODUCT.md` | Product context for the store landing page. Read by the `impeccable` skill, which expects it at the repo root — leave it there. |
| `Books/website/` | The landing page and its design tokens |
| `Books/` (rest) | Eight book projects |
| `UI-Vault/` | Design references — prompts, shapeshifter, book UI, design systems |
| `.impeccable/` | That skill's cache, shots and surface briefs. Ignored. |

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

**The app runs against `InkDesk`.** `IDEAVERSE/Magazine` is the state the
magazine was in before the format migration (`cli-shim/migrate-magazine.mjs`);
the live copy has moved on by three days of audit and revise work.

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
| 473 MB | `Books/` | **No.** Eight projects, mostly images. |
| 448 MB | `Magazine/` | Superseded by InkDesk, but see below |
| 198 MB | `.window-profile/` | Yes — a Chromium profile the agent tooling made |
| 102 MB | `cli-shim/inkos/` | Yes — one `vendor-inkos.mjs` away |
| 60 MB | `UI-Vault/` | **No.** Design references. |
| 34 MB | `.git` | — |
| 586 KB | `_backups/20260823-163914` | Yes — a snapshot of `cli-shim` that git already holds |

`Magazine/` is not purely stale. Alongside the superseded issue it holds
`EDITORIAL-METHOD.md`, `Reference Image/`, `_archive/` and `magazines/film/`
with a packaged zip — none of which exist in InkDesk. Those are worth keeping
whatever happens to the rest.

---

## Small duplicates

- `.agents/skills` and `.claude/skills` hold the same `social-media-carousel`,
  byte for byte. Both ignored.
- `specs/archive/quire-plan-v1.md` is the superseded first Quire plan. It used
  to be `specs/quire-plan.md` — two files called "quire plan" with different
  phase numbering, which is how a plan stops being a plan.
