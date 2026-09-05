# What exists, and where

A map of the load-bearing parts, kept so a change can start from what the code
does rather than from a guess about it. Every entry here was read out of the
file it names.

**Update this file in the same change that makes it wrong.** A stale map is
worse than none: it is a guess wearing the clothes of a fact.

## Two installs, one machine

| | folder | shim | studio | workspace |
|---|---|---|---|---|
| dev | `~/IDEAVERSE/Quire-Dev` | 8788 | 4568 | `~/Quire-dev` |
| prod | `~/IDEAVERSE/Quire-Prod` | 8787 | 4567 | `QUIRE_WORKSPACE`, else `~/Quire` |

Ports are compiled in: `desktop/build-dev.mjs` sets `QUIRE_SHIM_PORT` /
`QUIRE_STUDIO_PORT`, read by `option_env!` in `desktop/src-tauri/src/main.rs`.
`main.rs` passes both to every child it spawns, which is what makes the shim
port usable as an install identity.

`desktop/quire-ctl.mjs` is the only way to drive either one:
`node desktop/quire-ctl.mjs <dev|prod> <path|up|down|status|chat> [json]`.
Under Git Bash a leading `/` is rewritten to a Windows path — prefix with
`MSYS_NO_PATHCONV=1`.

## Where the workspace comes from

`cli-shim/workspace.mjs` owns this, and nothing else may recompute it.

Precedence in `root()`:
1. `~/.quire/workspace.<instance>.json` (prod: `workspace.json`) — chosen in Settings
2. `QUIRE_WORKSPACE` for prod; `QUIRE_WORKSPACE_DEV` for dev
3. an existing default folder for the install
4. that folder's name, whether or not it is there

`INSTANCE` is `QUIRE_INSTANCE`, else `"dev"` when `SHIM_PORT` is not prod's
8787. A dev install deliberately ignores a bare `QUIRE_WORKSPACE`: it is set
once at user level and every process inherits it, so honouring it put dev back
in prod's books no matter what else was arranged.

The config file lives in `~/.quire/`, never inside the workspace — the file
that says where the workspace is cannot live in it.

## Where the model comes from

One place: `<workspace>/inkos.json`, key `llm.model` / `llm.service`.

- Read by every pipeline through `loadCurrentProjectConfig`.
- Read and written over `GET|PUT /api/v1/project/default-model`.
- Chat writes it: `chooseModel` in `pages/ChatPage.tsx` PUTs on every pick.
- Chat reads it: `pickModelSelection` in `pages/chat-page-state.ts`. The
  project config wins over whatever the tab remembers. It used to be the other
  way round, which put two different models in use at once with no way to tell
  which was which from either screen.
- Chat sends its model per turn: `store/chat/slices/message/action.ts`.

Machine-level, **not** workspace-level, so changing folders never changes it:
- which CLIs are allowed — `~/.quire/agents.json`, via `cli-shim/agents.mjs`
- which models exist — probed live per CLI in `cli-shim/server.mjs`

## The model catalogue

`listModels()` in `cli-shim/server.mjs`. Per CLI, `a.models(a.bin)`; on an
empty result it substitutes `a.fallback`, a small static alias list.

Devin's real catalogue (~197) only exists over an ACP session — `acp()` spawns
the CLI with `cwd: WORKSPACE` and sends `session/new`. That session is slow on
the first call after a restart, so the 8-alias fallback stands in. Cache TTL is
therefore 300s for a live listing and 15s for one that fell back, so a cold
start heals itself instead of reporting 33 models for five minutes.

`GET /v1/status?fresh=1` forces a rescan.

## Skills

`packages/core/src/skills/external-loader.ts` scans, always and unconditionally:
`~/.openclaw/skills`, `~/.agents/skills`, `<workspace>/.agents/skills`,
`<workspace>/skills`, plus anything in `INKOS_SKILL_DIRS`.

`INKOS_SKILL_DIRS` **adds**; it cannot restrict.

**Only metadata reaches the prompt.** `serializeSkillCatalog` in
`agent-system-prompt.ts` emits `{id, name, description}` — measured at 82
skills / 31,660 chars / ~7.9k tokens. Bodies are injected only for skills that
are *forced* (requested by the UI) or pulled in mid-turn by `use_skill`. The
catalogue itself appears only when
`allowIntentSkillSelection = actionSource === "free-text" && no forced skills`,
so a confirmed production action carries none of it.

The real per-session cost is disk, not context: a recursive walk two levels
deep across four roots, then every `SKILL.md` read whole — 1.58 MB on this
machine — held in memory so that one or two might be activated.

The two home roots (`~/.openclaw/skills`, `~/.agents/skills`) belong to other
tools, are hardcoded in `configuredSkillDirs`, appear nowhere in the UI, and
cannot be turned off.

## What each production run gets

`PRODUCTION_SKILL_IDS` binds one skill per shape, and
`__tests__/production-skill-bindings.test.ts` asserts the invariant that a
non-long capability may **not** carry `quire-long-writing` or
`quire-story-review` — the shape-specific skill already covers its own review
(`quire-short-writing` is "构思、一次写完、整篇审改与包装").

Seven built-ins are bound to no capability on purpose, reachable through
`use_skill`: `quire-long-market-research`, `quire-short-market-research`,
`quire-long-story-analysis`, `quire-short-story-analysis`,
`quire-story-cover`, `quire-story-deslop`, `quire-story-import`. They answer
requests ("research the market", "analyse this novel", "de-slop this
chapter"), not stages of a run.

`publication` has no capability and no skill exists for it —
`createPublicationCreateTool` takes no skills at all. That is a real gap, and
it needs a skill written for issues, not a fiction skill rebound to them.

## Productions, and how status is counted

`packages/core/src/productions/registry.ts` — `PRODUCTIONS` is the one list.
Eight kinds, each with `id`, `label`, `outDir`, `auditable`:

`book`/books · `short`/shorts · `script`/dramas · `storyboard`/storyboards ·
`interactive-film`/interactive-films · `publication`/Magazine ·
`play`/worlds (not auditable) · `translation`/translations

`auditableRoots()` derives the walk from it. Never hardcode this list anywhere
else — a hand-kept copy had already drifted, looking for scripts under
`scripts/` while the runner writes `dramas/`.

In `api/audit.ts`:
- `listAuditTargets(root)` — every `.md` over 400 bytes under an auditable
  root, as `{path, name, kind, kindLabel, project, words, modified}`. `words`
  is `size / 6`, an estimate.
- `listAuditProjects(root)` — those grouped into `{kind, id, files, words}`.
- `readAuditProject(root, kind, id)` — one project, with per-file audit state.

State lives in two JSON files under `<workspace>/.quire/`:
- `audit-state.json` → `files[path]: FileAudit` (`checked`, `approved`,
  `reads`, `revisions`, `deslops`, `notes`)
- `findings.json` → `Finding[]` with `severity: blocking|warning|note` and
  `state: open|accepted|ignored`

- `workspaceSummary(root)` — the whole folder rolled up per kind, behind
  `GET /api/v1/workspace/summary`. Every auditable kind is listed even when
  empty, so the screen can answer "is there anything here".

It returns two groupings of the same walk: `kinds` (per production kind) and
`projects` (per creation, newest first, with a title derived from the folder
name). **A creation is the unit Home counts in** — a file is true and useless,
"three creations, one signed off" is the sentence someone came for.

Home reads it in four places, all in `pages/Dashboard.tsx`:
- the hero — all three numerals count **creations**: `approved` (every file
  signed off) / `in flight` (any not) / `this month` (touched in the last 30
  days). The third counted files once and read "42 this month" over three
  pieces of work, none started that month.
- "Waiting on you" — `deriveGates(books, publications, creations)`. Books and
  issues raise their own gates from generation state; every other creation
  raises one from audit state, ranked `blocked` (a blocking finding, which
  cannot be signed off around) → `needs a read` → `sign off`. A creation whose
  id already raised a book or issue gate is skipped, so nothing is said twice.
  Before this, a folder of shorts with 3 blocking findings and 22 unread files
  reported "clear", because none of those files was a chapter of a book.
  A creation's title comes from the folder name, so where the app already knows
  the real one (a book, an issue) that wins — otherwise a gate is raised
  against a slug read back as prose.
- "Back to work" — one tile per creation of **any** kind. Books and issues keep
  their own rows because they carry a real title and progress in chapters and
  pages; everything else comes from the folder walk. `MARKS` maps a kind to its
  `mark-*` silhouette, of which vermilion.css ships one per form.
- the "In this folder" panel beside the machine.

Setup names the folder and says nothing about what is in it — that question
belongs on Home.

**The counting vocabulary, used by every screen that reports status:**
- read = `audit.checked` is set
- signed off = `audit.approved` is set
- open = findings on that path with `state === "open"`
- blocking = those with `severity === "blocking"`

## Sessions

`sessionKind` is one of chat / book-create / book / short / play / script /
storyboard / interactive-film / interactive-film-authoring / edit /
publication (`SessionKindSchema`).

An earlier note here said it is "never branched on". **That was wrong.**
`selectAgentTools` in `agent-session.ts` branches on it for every kind, and the
tool list a turn gets is decided by two things together:

```
isConfirmed(intent) = (actionSource === "button" || "slash")
                      && requestedIntent === intent
```

A **typed** message is `actionSource: "free-text"`, so `isConfirmed` is never
true for it and no production tool is in the list at all. A short session that
is typed into gets `[propose_action, ingest_material, retrieve_material,
…storyCheck]`. `short_fiction_run` becomes reachable only on the *next* turn,
after `propose_action` has drawn a confirmation card and the user has pressed
its button.

This is deliberate — nothing forty pages long starts from an offhand sentence —
but it means **a pasted prompt cannot call a production tool, however
explicitly it asks.** The route is: type → `propose_action` → card → confirm.

`ChatPage.tsx` still lists `sessionIdsByBook[activeBookId]` for its own
purposes, but the picker is back: `Conversations` in
`components/chat/ChatContextRail.tsx` calls `GET /api/v1/sessions?bookId=all`
and switches with `activateSession` + `loadSessionDetail`.

`listBookSessions(root, bookId)` in `core/src/interaction/book-session-store.ts`
takes `undefined` for "every shelf" — `null` is a real book id there, meaning
"not inside a book", so before this there was no way to ask for all of them.
The route maps `bookId=all` to it; every other value, absent included, still
means one shelf. `isPipelineSessionId` keeps `publication--*` transcripts out:
they are how a failed stage is diagnosed, not conversations.

The rail is the only place in the app that navigates and hands references to
the composer from the same list, so the current conversation carries
`aria-current="true"` and vermilion.css marks it.

The thread still does not refresh from a turn it did not originate.
