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

## Names

Quire's own names only: `<workspace>/.quire/` for app state (sessions,
tasks, secrets, the search index), `<workspace>/quire.json` for config,
`<workspace>/research/` for gathered pages, `~/.quire/` for machine
settings (`.env`, `mcp.json`, the workspace pointer), `QUIRE_*` for
environment settings, `quire` for the CLI.

The InkOS names (`.inkos/`, `inkos.json`, `INKOS_*`) survive in two
places and nowhere else:

- `cli-shim/migrate-names.mjs`, run by `cli-shim/studio.mjs` before the
  engine starts: moves `.inkos/` into `.quire/` and `.inkos/materials`
  into `research/` (manifest paths rewritten), renames `inkos.json`, renames
  `INKOS_` keys in `.env` files, and copies (not moves) `~/.inkos/` into
  `~/.quire/`, because an installed older build still reads the old home.
  It never overwrites; a clash is left in place and logged. It only runs when
  the staged engine is `quire-runtime`, so a restart before a rebuild cannot
  move files out from under an engine that still reads the old names.
- `normalizeSkillId` in `core/skills/registry.ts`: old `inkos-*` skill ids
  still resolve.

The licence credit (sidebar, README, PRODUCT.md) and the upstream repository
URL name InkOS on purpose. The rename was agreed on 2026-09-03 and not done
until 2026-09-16, because it was written down nowhere.

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

One place: `<workspace>/quire.json`, key `llm.model` / `llm.service`.

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
`<workspace>/skills`, plus anything in `QUIRE_SKILL_DIRS`.

`QUIRE_SKILL_DIRS` **adds**; it cannot restrict.

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

**Design and illustration are bound to stages, not to types (2026-09-17).**
`skills/design-skills.ts` maps a stage's own tag to the skill it is answered
under — `design*`/`layout`/`build` → `quire-editorial-design`, `art*`/`cover` →
`quire-illustration` — and both `ask` factories (`createStoryAsk` for every
type's design desk, `createPublicationAsk` for the magazine) prepend that
skill's text to the stage's system prompt. Before this the editorial-design
skill reached a model only through the magazine page writer, and
`quire-illustration` was bound to nothing at all and had never reached one.
`ProductionSpec.skills` in the registry is read by no code; the live binding is
`PRODUCTION_SKILL_IDS` plus this stage map.

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

Every type's content list now opens with `research` (22 §3). It passes straight
through unless a world is pinned — see "Where and when a work is set".

In `api/audit.ts`:
- `listAuditTargets(root)` — every `.md` over 400 bytes under an auditable
  root, as `{path, name, kind, kindLabel, project, words, modified}`. `words`
  is `size / 6`, an estimate.
- `listAuditProjects(root)` — those grouped into `{kind, id, files, words}`.
- `readAuditProject(root, kind, id)` — one project, with per-file audit state.

State lives in two JSON files under `<workspace>/.quire/`:
- `audit-state.json` → `files[path]: FileAudit` (`checked`, `rewritten`,
  `approved`, `reads`, `revisions`, `deslops`, `notes`)
- `findings.json` → `Finding[]` with `severity: blocking|warning|note` and
  `state: open|accepted|ignored|fixed`. `fixed` = the writer rewrote the span
  (`POST /findings/:id/rewrite` → `rewriteFinding` in `findings-store.ts`):
  only the quote (or its paragraph with `scope: "paragraph"`) is replaced,
  `rewriteDrops` refuses a result that loses a name/dialogue line or moves
  length by more than a third, the old words stay in `replaced`, and every
  other finding on the file is re-pinned with `relocate`.

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
- **stale** = `audit.rewritten` is later than `audit.checked`. A verdict is
  about the text that was read, so a file rewritten after its last check is not
  clean, it is unread: `fileState` in `pages/AuditPage.tsx` returns the
  never-read dot with "changed since last read". Every pass that writes a file
  records `rewritten` — the restyle job included, which for a long time
  recorded nothing at all and left restyled chapters showing green.
- signed off = `audit.approved` is set
- open = findings on that path with `state === "open"`
- blocking = those with `severity === "blocking"`

**Rewriting one file rewrites the copies of it.** A short is on disk four times
over — `final/chapters/NNNN.md`, `final/full.md`, `final/<Title>.md` and
`final/short-story.json` — and every pass that changes a chapter has to put the
other three back in step or the audit screen lists the same story twice, saying
two different things. `recomposeShortFiction` in `core/pipeline/recompose.ts`
folds the chapter files back into the draft and re-renders the long copies
through `renderShortFictionDraftMarkdown`; `composedDirOf` says whether a path
is a chapter of such a set, and answers `null` for work that keeps no long copy
(a book, a storybook), which makes the call free for them. It is wired into
every door that writes a chapter: `PUT /audit/file`, `/audit/file/revise`,
`/audit/run` when a revise landed, `/audit/restore`, and the restyle job.

## Pictures

- **Art policy per type** — `artPolicyOf(type)` in `core/productions/registry.ts`:
  surfaces, realism, world scope, technique pool. Book, short, translation,
  storybook, storyboard: illustration only, `realism: "forbidden"`. The
  magazine: photo/illustration/infographic/type/texture, one world per section.
- **Which engine draws** (23 §3) — `cli-shim/engines.mjs`. Every picture goes
  through `POST /image/render`, never `/comfy/generate` directly. `engines.json`
  (beside it) declares what each engine can do; `choose()` matches that against
  what the brief says it `needs` — a picture with a cast member needs `refs` and
  `seed`, so it never goes to Canva. `cli-shim/canva.mjs` speaks JSON-RPC to
  `mcp.canva.com` for the picture and REST to `api.canva.com` to export it, with
  the token read from the workspace's `.quire/secrets.json` (`services.canva`).
  Allowance is a local estimate in `.quire/canva-usage.json`, because Canva
  exposes no remaining-allowance API; the real safety net is the error, which
  routes the same job back to ComfyUI and records `fallbackFrom: "canva"` in the
  recipe. Per-surface preference lives in `.quire/engines.json`, edited by the
  Picture engine card in Connections. `GET/POST /api/v1/engines` proxies it.
  Self-check: `node --test cli-shim/engines.test.mjs`.
- **One prompt builder** — `composeImagePrompt()` in `core/pipeline/image-prompt.ts`:
  world fragment + technique + brief + Cast Sheet trait lines + treatment +
  props; negative = brief + policy block + world's own. Photo words are
  scrubbed where realism is forbidden. Used by `design.generate`
  (`executors.ts`), the magazine's `artPage`, storyboard art, cast candidates
  and the gallery's redraw.
- **Treatments** (09 §1) — `core/pipeline/treatments.ts`: `TREATMENTS_BY_SLOT`,
  `postProcessFor(treatment, colours)` (the ops the shim runs), and
  `rollTreatment()`, seeded by work/unit/k/salt: never the treatment of the unit
  before, prose at most one full-bleed in three, storybooks alternate
  full-bleed with white ground. `pageCandidates(pageType)` for the magazine. The
  rolled answer is written into the brief (storybook spread briefs, ArtDirector
  briefs, the magazine's `page.briefs[i].treatment`) so a rebuild reproduces it.
- **Post-process** — `cli-shim/postprocess.mjs`, stdlib only (a PNG codec over
  zlib): cutout (flood-fill key of the white ground every cutout prompt asks
  for — not a segmentation model), vignette, bleed-edge, duotone, one-colour,
  wash, tile, and a kit's masks and paper tile. `generate()` runs its `post` ops
  on the file it wrote, keeps the untreated render at `<dir>/.raw/<name>`, and
  records `postProcess` and `raw` in the recipe. `POST /image/post` re-treats
  from `.raw` (workspace paths only); `POST /image/kit` draws a kit's masks.
  Self-check: `node --test cli-shim/postprocess.test.mjs`.
- **The art plan** — `studio/src/api/design-desk.ts` wraps `design.artplan` for
  `WORLD_TYPES` (book, short, storybook, storyboard, interactive-film): world
  (`ensureWorld`), cast (`ensureCast`, once — `design/cast/asked.json`), the
  engine's own plan, then for book/short/interactive-film the ArtDirector
  (`core/pipeline/art-director.ts`, held to the policy's slots, per-unit cap
  and treatment table). The engine's plan now writes one cover for a book (unit
  1), not one per chapter; a unit with nothing to draw gets `<unit>-none.json`,
  which generate and review take as a finished "no picture".
- **Worlds** — per work at `<workDir>/design/world.json` (`workDirOf`: magazine
  issues are `Magazine/issues/<id>`), chosen once from the work's text by
  `ensureWorld`. A re-world (the desk) moves the old one to
  `design/.history/`; the gallery marks pictures older than `world.at` stale.
  Magazine sections get theirs from `runDesign` into `issue.design.sections`,
  which `worldFor()` reads.
- **Cast Sheet** (08 §9) — `core/pipeline/cast.ts`; sheets at
  `<workDir>/design/cast/<id>/sheet.json`, reference candidates beside them.
  `castIn()` names who is in a brief; `generate` appends their `traitLine()`
  and records `characters`, `castSheets` and `identity: "prompt-only"` — no
  installed workflow can take a reference image for this base model.
- **Design Kit** (07 §1b) — `core/pipeline/kit.ts`; a library at
  `design/kits/<kitId>@<v>/` (kit.json, swatches.json, text-styles.json,
  fx.json, masks/, patterns/, captured/), `kitIdOf(type, id[, section])`.
  Proposed from the world, deterministically; approved on the desk. Choosing a
  picture in a kit slot (tailpiece, margin, texture) captures it, and a later
  brief with the same `subjectKey` is copied from the kit instead of rendered
  (`engine: "kit"`, `reusedFrom`).
- **A recipe beside every picture** — `generate()` in `cli-shim/comfy.mjs` writes
  `<image>.recipe.json` whenever it writes a file: the caller's `recipe` facts
  (type, id, unit, slot, prompt parts), then what actually ran. It also merges
  the workflow's negative with the caller's instead of replacing it.
- **Gallery** — `studio/src/api/assets.ts`: `GET /api/v1/assets?type&id[&trash=1]`,
  `POST /api/v1/assets/{approve,delete,restore,purge,redesign,treat}`. A verdict
  lives in the recipe (`approved`); choosing one clears it on others of the same
  unit + slot, and for a magazine points `page.image` at it (what Affinity
  builds from). Delete moves image + recipe to `<workDir>/art/.trash/`; purge
  works only inside the trash. Redraw is a job (`design.redesign <file>`) that
  writes `<stem>-rN.png` with `parent` and `changeNote`; `treat` re-runs a
  treatment from `.raw` without drawing again. `GET /api/v1/project/files/*`
  and the gallery share one rule, `isServableImage`: `shorts/`,
  `interactive-films/`, `covers/`, `design/kits/`, and inside a production an
  `art/`, `my-final/` or `design/cast/` folder. The gallery's walk skips
  `design/`; other images under a book stay private.
- **Affinity placement** — staging copies each page's `image` into the Desktop
  `_assets` as `NN.png` (before, only the issue's `_assets/` was staged and
  nothing writes there now). `P.treatment` comes from the page's first brief: a
  cutout goes on the outer edge with `T.cutout()` and the column beside it is
  stepped below it, because the script API cannot create a text wrap.
  `T.pattern()` places a kit texture behind type at ≤ 20 %.
- **One verdict, one stream** (04 §7, 18 §1) — `studio/src/api/taste.ts`:
  `POST /api/v1/feedback` checks surface/verdict/cause against `CAUSES`, appends
  to `<workspace>/_taste/feedback.jsonl`, then acts — a picture: keep chooses,
  reject trashes, redo/tweak redraws with the note and the causes' hints; a
  page: redo/tweak files a `feedback/<cause>` finding (kept by `recordRun`, like
  `reader/`). Gate approve/reject, finding accept/ignore, magazine page notes
  and the desk's world/kit/cast decisions append too. `components/Verdict.tsx` is
  the one control. Proposals: `_taste/proposals.jsonl`,
  `GET /api/v1/taste/proposals`, accept/ignore — writing `rules.jsonl` is the
  taste engine's (18), not built.
- **Your final** (04 §6) — `<workDir>/my-final/`, not `final/`: a short's
  pipeline already writes there. `studio/src/api/final.ts`: `GET /api/v1/final`,
  `POST /api/v1/final/upload` (data URL; pictures to `my-final/assets/`),
  `POST /api/v1/final/learn` → job `taste.ingestFinal`: sentence diff and voice
  drift (`core/pipeline/final-learn.ts`), PDF pages against the newest
  `build/*.pdf`, pictures into the kit as drafts; summary in
  `my-final/final.json`. An `.afdesign` is listed, not read. The audit walk
  skips `my-final`.
- **Reader map** — `core/pipeline/reader-sim.ts`, `POST|GET /api/v1/audit/reader`.
  Maps are kept in `.quire/reader.json`; cold paragraphs become `note` findings
  `reader/<persona>`, replaced on each reader run and left alone by `recordRun`.

## Where and when a work is set

`core/pipeline/setting.ts` owns the artefact: `<workDir>/setting/` holding
`setting.json` (place, time, lens, `fidelity: strict|flavour|loose`), `bible.md`
(nine fixed headings, so a slice can be fetched by name), `lexicon.json`,
`sources.jsonl` and `cards/<unit>.md`. The old two-field `eraConstraints` still
loads (`settingFromEra`) but never switches itself on — that flag is set by a
heading existing, which is not a person asking for research.

- **The stage** — `content.research` is declared first in **every** type's
  content list (`registry.ts`). It is conditional in effect, not in the graph:
  `core`'s built-in executor is a pass-through, and the Studio replaces it with
  the real one (`api/setting-desk.ts`). With nothing pinned it detects, at most
  once per work, whether the brief names a real place and time, writes the
  answer to `setting/ask.json` and lets the writing proceed. A stage with **no**
  executor stops a run, which for the first stage of every graph would mean
  nothing ever starts — hence the core pass-through.
- **Researching** — `core/pipeline/setting-research.ts`: two queries per bible
  section through `allSearchSources()`, claims dropped unless a source carried
  them, sections written as they land, then one pass for the word list. Nothing
  to search with is reported, not invented around.
- **Where it lands** — the Writer gets a Setting Card built from the chapter's
  own plan (`buildSettingCard`, ≤600 tokens, retrieval not summary); the auditor
  gets dimension 12 switched on and a deterministic pass over
  `lexicon.forbidden` (`core/pipeline/anachronism.ts`) whose findings carry the
  sentence, so they locate; the ArtDirector gets the period objects and the
  forbidden list in the negative prompt; a restyle is told which period words
  not to modernise.
- **Library and series** — `settings/<id>/` is a researched world any work can
  reuse (copied, never referenced, with `reuseOf` recording where from).
  `series/<id>/` (`core/pipeline/series.ts`) adds the shared cast, world and a
  promise ledger; `seriesBrief()` hands a later work the earlier one's still-open
  promises in the words they were made.
- **Routes** — `GET/POST /api/v1/setting`, `/setting/research`,
  `/setting/lexicon`, `/setting/library`, `GET /api/v1/settings`,
  `GET/POST /api/v1/series`. `components/SettingCard.tsx` on the audit screen.

## Voice, measured

`core/agents/style-fingerprint.ts` is the half of a voice that is countable:
function-word frequencies (the Burrows' Delta basis), sentence-length buckets,
dialogue share, punctuation per 1000 words, fragments, adverbs. `distance(a, b)`
is 0 for identical and ~1 for a different writer; `gaps()` names the three
furthest-apart features in words a rewrite can act on. Stored as `v2` inside
`style_profile.json`, optional so every profile already on disk still loads.

- **Exemplars** (`core/pipeline/exemplars.ts`) — saving a voice keeps 3–5 real
  passages in `styles/<id>/samples/`: the ones closest to the sample's own
  fingerprint plus a dialogue and a description extreme. Shown to the rewrite
  and appended to the Writer's guide, so new chapters land in the voice rather
  than being restyled into it afterwards.
- **Restyle** (`core/pipeline/restyle.ts`) — chunked on headings/paragraphs,
  each chunk shown the exemplars that match what it is, then measured: over
  `RETRY_ABOVE` it retries **once** with the named gaps, and keeps whichever
  attempt actually landed closer. Two guards refuse a write: the length ratio,
  and `quotedLinesKept` — a rewrite that keeps the prose and drops three
  exchanges passes the first and fails the second. Returns
  `{text, before, after, chunks}`; the route records `voiceDistance` and
  `voiceDistanceBefore` in `audit-state.json`, which the audit screen shows as
  "0.31 → 0.12".
- **Blends** (`core/pipeline/blend.ts`) — up to five voices, weights normalised
  to 1, and **one owner per facet**; a facet claimed twice goes to the heavier
  voice and the loser is reported (`droppedFacets`) rather than dropped in
  silence. `blendTarget()` takes an owned facet outright and averages the rest,
  so a mix stays specific instead of sounding like nobody. Written to the work's
  `style.json` as `blend`; the mixer is in the Style screen.
- **Drift** — `ruleFindings` compares the file against its target and files a
  `style-drift/voice` warning past `DRIFTED_ABOVE`, so a long book reverting to
  house style is caught rather than discovered.

## From a finished work to a printed copy

`build.export` now ends at a print folder, not only at an epub or a proof.

- **Typesetting** — `core/pipeline/typeset.ts` writes Typst source and compiles it
  with the `typst` binary (`QUIRE_TYPST` or PATH). Book, short and translation get a
  reflow interior (chapters open on a right-hand page, running heads, widow and orphan
  control, a gutter sized from the page count); storybook gets picture spreads with
  bleed; storyboard gets a panel sheet; script gets industry screenplay layout. Prose
  goes in as Typst string literals, so nothing in a manuscript is read as markup.
  No Affinity reflow script: the magazine keeps its Affinity build, everything else
  uses Typst.
- **Print maths** — `core/pipeline/print.ts`: `print.json` per work (trim, binding,
  paper, service, ISBN), spine width per service (KDP's published per-page figures;
  Lulu, IngramSpark and Blurb are estimates and say so), cover wrap geometry, EAN-13
  from the ISBN, and a deterministic preflight on the PDFs (page count and parity,
  page size against trim and bleed, fonts embedded, picture dpi, cover size).
- **The folder** — `<work>/build/print/<service>/`: `interior.pdf`, `cover.pdf`,
  `preflight.json`, `CHECKLIST.md`. Nothing is uploaded or ordered: Lulu's API takes
  files by public URL, and the manuscript stays on the machine.
- A machine without Typst still finishes a book (epub) or storybook (proof); the log
  says what is missing. A short, script, storyboard or translation fails the export
  with the install line. Routes: `GET/POST /productions/:type/:id/print`,
  `POST …/print/build` (a job). No screen shows it: the print card was dropped
  2026-09-17 (analysis/debt.md), so `components/PrintCard.tsx` is unmounted and
  print is reached over the API until a build surface asks for it.
- Short, script, storyboard, translation and interactive film now read themselves:
  `content.audit` (and `content.destyle` for short and script) are registered per type
  in `server.ts` and call `auditUnit` from `api/audit.ts` — the same path as the Audit
  button. A translation is audited from a regenerated `chapter-NNNN.md` and never
  de-slopped.
- **One spine for every kind (2026-09-17).** `SPINE` in `registry.ts` is the whole
  list — `research, plan, write, factcheck, audit, destyle | artplan, generate,
  review | layout, export` — and every type declares all of it with all three
  gates. A step a kind does not perform is *skipped*, not absent: `pipeline.skip`
  maps the stage id to the sentence the screen shows ("A novel is not held to the
  record"). `advance` walks past a skipped stage, logging `stage:skipped` with the
  reason; `runStage` does the same for a run already standing on one; a macro
  whose every step is skipped signs its own gate (`by: "quire"`), so a translation
  never asks for a design sign-off it has no design for. The Run screen draws the
  whole spine, skipped steps greyed with the reason (`.st.skip`). Before this, a
  step a kind did not need was missing from the graph, which is why a short story
  full of real history could not be fact-checked: as a kind, it had no such stage.
- **Stopping one unit** — `cancelUnit(ref, unit)` (`orchestrator.ts`, route
  `POST /api/v1/productions/:type/:id/units/:unit/cancel`). Each unit gets its own
  signal chained to the stage's; stopping one leaves it unfinished rather than
  failed, so the stage stays open and the next pass picks that unit up. The job
  record carries the unit in hand (`setJobUnit`).
- Gates are sign-offs, not stops. `advance` in `pipeline-state.ts` walks through a
  gate and leaves it `waiting`; approving or withdrawing only records, starts and
  cancels nothing, and can happen before the run reaches the gate (the approve
  route makes a run if there is none). Work with no run starts its pictures from
  the Audit screen's Start button (`POST …/content-ready`). The Run screen reads
  its stages from `pipeline.json` when a pipeline run is in front.

## The magazine's bar, and your own reading

- `core/pipeline/magazine-bar.ts`: the writing bar per audience (sentence length,
  Flesch-Kincaid grade, paragraph length, word cap per density, definition-first
  openings, bare numbers, unsourced did-you-knows, a did-you-know per spread, section
  names that are school subjects), the surface mix against `artPolicy.mix`, and the
  beauty pre-screen on a rendered page (whitespace, accent share, busyness, contrast
  from the shim's `POST /image/inspect`). The bar and the mix join `auditPages`, so the
  revise pass acts on them; the pre-screen comes back with `renderPage`.
  An issue's reader is `issue.audience`; it defaults to "general".
- `core/pipeline/personal-sources.ts`: notes folders (Obsidian works) and a Zotero
  library (read from a copy of `zotero.sqlite` via `node:sqlite`) as a `local`
  search source that `allSearchSources` puts first. Config:
  `.quire/personal-sources.json`; route `GET/POST /api/v1/sources/personal`; card
  "Your reading" on Connections.
- Recurring issues: `issue.recurring` (`weekly`/`monthly`), set with
  `POST /publications/:id/schedule`. The magazine routes check hourly; a due issue
  gets its successor (`startNextIssue`), which runs research → audit and stops at the
  copy sign-off. The flag moves to the new issue.
- Skills `quire-editorial-design` and `quire-illustration` ship in `core/skills/` and
  are bound to the magazine in the registry.
- LoRAs: workflows may declare a `lora` block (where model and clip come from and who
  reads them). `cli-shim/loras.json` plus `<workspace>/workflows/loras.json` list
  LoRAs by base and technique; `comfy.generate` splices up to two in, only when the
  file is in `ComfyUI/models/loras`, and records them in the recipe. The pack ships
  empty. A second builtin workflow, `flux-schnell` (Apache-2.0), is available; the
  default stays `z-image-turbo` (marked `"default": true`).

## Taste

`core/pipeline/taste-engine.ts`, routes in `studio/src/api/taste.ts`, page
`pages/TastePage.tsx`.

- **Distill** — `POST /api/v1/taste/distill` (a job). Counting first: a cause chip
  pressed with weight ≥ 5 on one work proposes that cause's rule for that work; the
  same cause on two or more works proposes it everywhere. Finals weigh ×3. Then, when a
  model is wired, notes and diffs per work are distilled (cited, ≤ 5 rules, no
  duplicates). Proposals someone already ignored are never proposed again.
- **Rules** — one `_taste/rules.jsonl`, each rule with a scope (`work`, `surface`,
  `style`, `type`). Accepting a proposal adds the rule. Rules reach the book writer's
  prompt ("House rules") and the ArtDirector's.
- **Trial** — the next three verdicts in a rule's scope are counted; three redos flag
  the rule for review. Nothing is retired automatically.
- **Taste Pack** — `POST /taste/pack/export` zips voices, work worlds, latest kits and
  rules (work scope dropped) into `_taste/packs/<id>.zip`, never feedback or
  manuscripts. `POST /taste/pack/import` installs under `pack-<id>-…` names; its rules
  enter the proposals queue. `POST /taste/clone` copies a work's style mark, world,
  cast and rules to another work.
- Not done: number rules are recorded but nothing enforces them yet (no validator
  reads them); rules reach only the book writer and the ArtDirector, not the other
  types' writers.

## What is running

The job queue (`core/pipeline/jobs.ts`) is in memory, serial, and the only
account of a stage in flight. `GET /api/v1/jobs` lists it and every change is
announced over SSE as `job:queued|started|progress|done|failed|cancelled`.

The screens read it through `hooks/use-jobs.ts`, held in `App.tsx` **above the
router** so a job outlives the page that started it. It seeds from `GET /jobs`
(the stream starts empty on every load, so a reload mid-stage would otherwise
show nothing) and follows the stream from there. The rail card and the run
screen both render from that one list, and `POST /jobs/:id/cancel` is reachable
from either.

Work that runs beside the queue is listed with `track()` in the same file: it
appears in `GET /jobs` and on the rail, and cancelling it aborts the
controller the work already holds, but it never takes the queue's single
slot. Two callers use it:

- `run()` in `publication-runner.ts` lists every magazine run as
  `{type: "publication", id}`, whether chat, the issue page's resume or the
  recurring-issue clock started it, with the stage and page as its progress.
  `liveJobFor` is how the issue page knows a run is live, and which stage
  pulses on its strip.
- Confirmed chat productions in `server.ts` are listed as `{type: "task"}`,
  named after the work in their payload. `publication_create` is skipped
  there because its runner already lists it.

- `POST /api/v1/materials/crawl {url, stopAt?, maxPages?}` lists itself as
  `{type: "research"}`, stage `gather`. It reads the article once
  (`<article>`, else `<main>`, else the body, with `nav`, `footer`, `aside`,
  `script`, `noscript` and `style` dropped first; just8mm.com has no
  `<article>`, and its menu and ClickCease tag were once archived as
  research), cuts it after the section whose
  heading contains `stopAt` (an unknown heading is an error), and archives the
  kept part plus every page it links to as one `.md` each in
  `<workspace>/research/` (visible, kept for later) with purpose `research`, capped at 100 pages
  (`core/materials/crawl.ts`). The research stage of a magazine reads those
  first, as "Your own material".

A magazine has **two files**, and they are not in the same folder:
`Magazine/issues/<id>/publication.json` (the issue's content: pages, research,
web, `lastError`; the issue page reads it) and `Magazine/<id>/pipeline.json` (the
run: stage, units, gates — the only account of where the run is; the Run page's
"Where it is" reads it). `ensurePipeline` keeps a run file
it finds, so a new issue reusing an old id inherited the old run's pages and
failure. `createIssue` and `removeIssue` now move that file aside
(`retireRunFile`); anything cleaning up an issue by hand must take both
folders.

**The magazine runs on the shared pipeline (2026-10-05, plan 13 rev. C).** Its
stages are executors — `publicationExecutor(ctx, stage)` in `publication-runner.ts`
— and `run()` drives them with the shared `runStage` from `orchestrator.ts`,
against `pipeline.json`. A page is a unit; a stage over the whole issue (research,
plan, fact-check, audit, design, build) does its work on unit 1 and passes the
rest. `runStage` takes an `executor` resolver because a magazine run carries its
model call in its context (chat's session, the issue page's, the recurring
clock's), which a boot-time registry cannot hold. The run file is created at the
first stage, sized to the extent, and `resizeUnits` corrects it when the plan
lands. A `from` earlier than where the run stands rewinds it (`rewindTo`, history
event `stage:rewound`); later jumps forward. `design.review` and `build.layout`
are declared skips for `publication` (pre-screen happens per rendered page; the
build lays out and exports in one pass). `SPINE_STAGE`/`STAGE_ORDER` survive only
as the short names routes and the chat tool use. `runStage` now credits a unit
to the stage it ran (`satisfies: stage`): `writePage` reports its own unit, and
the last page was otherwise credited a second time to the next stage.

Copy and design sign-offs are said twice on purpose: the issue's flags
(`approved`, `designApproved`) are what the magazine's own stages check, and
`approve`/`unapprove`/`approveDesign`/`unapproveDesign` (and a rewrite clearing
the copy sign-off) also approve or withdraw the run file's `content`/`design`
gate, which Home and the Run page read.

**The connection web (plan 13 rev. B).** After research, `prompts.web` turns the
report into `issue.web` (`IssueWeb`: centre, question, rings, sourced nodes,
links with a `cue` word, threads, wonder, accent, motif); `readWeb` drops unsourced
nodes and links to missing nodes. The plan prompt receives it (`{{web}}`) and each
page gets `ring`, `links[{to, why, cue}]` and `threads`. The page prompt gets
`{{centreLine}} {{linksLine}} {{threadsLine}} {{wonderLine}} {{signatureLine}}`
from `connectionLines`. `connectionFindings` in `magazine-bar.ts` joins
`auditPages`: an unwritten bridge (warning, page-level, so revise acts), a thread on
fewer than three pages, a wonder told fewer than twice, a last section that never
returns to the question, a Voices page with quotes and no source. Four page types
are the brand's recurring pages — `map`, `where-else`, `voices`, `in-your-hands` —
and `checkPlan` reads `rules.requireTypes` and `rules.closingType`. Pillars are no
longer a quota (`requireAllPillars: false`); they remain research lenses.

**The brand book** is `<workspace>/Magazine/house_style.md`, read by the rule
stack before the series folder (`buildRuleStack` takes several `rulesDir`, broadest
first). The voice prompt no longer borrows another magazine's register.
`voiceSkill` is `["quire-magazine-page", "mag-content"]`: Quire's skill is first,
so it is the voice; `mag-content` stays listed only so `voice-claims.ts` keeps
redirecting its description to `publication_create` and a chat model does not
use it as a second, pipeline-free way to make an issue.

**Design constants.** The design prompt's section block now carries
`brandDesignLines`: one type pair for the issue, one accent (the web's) as the
only strong colour, the web's motif in `fixed.divider` and every section's
imagePrompt. `checkDesign` no longer refuses sections that share a typeface.
tk.js tints every section with `spec.palette.accent` when one is set; `linkNote`
draws "→ p.N" beside the folio for a page with a link; `webMap` draws the Map from
`mapData(issue)` in `affinity.mjs` (rings, their pages, ring pairs tied by a
page's bridge) — on a spread from its left-hand page.

**Gallery: edit a picture's description.** `POST /assets/redesign` takes
`subject`, which replaces what the picture shows; the style still comes from the
world at render time. For a magazine page the brief at that slot is rewritten too
(`editIssuePage`), so the next art run draws the new words.

`run()` also tells the run file how a run ended: a throw marks it `failed`
with unit 0 carrying `<stage>: <reason>` (as `markInterrupted` does), a Stop
marks it `idle` (`pause`), and the next run clears either (`resume`). Before,
a run that failed at fact-check left the Run page on "running".

The issue page's Brief tab lists the research files (`researchInputs` in
`api/publications.ts`, from `listMaterialAssets`), cited ones first. A
confirmed run's progress lines go to its chat card live as `log` events with
its `executionId`; before, they reached the card only from the task snapshot
on reload.

The rail shows every live job, one card each. The topbar's "waiting" pill is
the length of Home's own list (`deriveGates` in `Dashboard.tsx`); it used to
count book chapters only and read "nothing waiting" while two works stood at
a sign-off.

Stage rows have five states: `done`, `running` (being worked on now, the only
one that pulses), `partial` (half done, idle), `failed` (ran and threw, reason
from `issue.lastError`), `pending`.
The dot colours come from `STAGE_CLASS` in `components/workflow.tsx`, used by
the issue strip and the Audit page alike: `done` green (`--ok`), `partial`
half green, `running` vermilion and pulsing, `failed` red (`--bad`). Done used
to be vermilion too, so finished stages and a failure looked identical.

Fact-check (`runFactCheck`) saves after every page. `issue.factCheck.pages`
records, per page, a hash of the text it checked (deck, body and box text);
the next run skips a page whose hash is unchanged, so a run that stops on
page 15 resumes at page 15, and `complete: false` shows as `partial`. A page
makes no model call when it has no body, its type is in the definition's
`factCheckSkipTypes` (magazine: plate, cover, contents), or `worthChecking`
finds no digit, quotation or mid-sentence name. Its two calls per page go
through `runWorkerAgent` (no tools, a one-line system prompt), not
`runAgentSession`: on the session path agy received ~54k characters of
workbench prompt and tool table, searched the workspace with its own tools,
and hit its own deadline. Each claim is judged on at most
`EVIDENCE_PER_CLAIM` (6) results, sources taking turns, each cut to
`SNIPPET_CHARS` (400) by `evidenceFor`; Tavily plus Brave at five long results
each had made one page's judging prompt 45,000 characters and three minutes.

A Stop is recorded as `lastError.stopped: true`. The strip then keeps the
stage's own state (a stopped fact-check is `partial`) with "stopped ·" in the
detail, instead of painting a person's own Stop as a red failure.

agy (`cli-shim/server.mjs`) runs with `--print-timeout` one minute inside the
shim's `RUN_IDLE_MS`. On its deadline agy exits 0 with "print timeout after"
on stderr and usually nothing on stdout; the shim now fails that turn as
`timeout`, and any clean exit with an empty reply as `upstream`
(`errors.mjs`), both retryable. Before, both reached the runner as an empty
200 and read as "model returned no JSON".

A written page's picture briefs come from the page reply's `image_prompts`
(`readBriefs`). The writer read only the old single `image_prompt`, so the
photography issue reached art with no briefs and art read "done, no page
asked for a picture"; art now stays `pending` while any page is unwritten.
The issue title (and a cover page's title) is cut to its cover line by
`coverTitle`: the part before a colon or dash.

Before this, a restyle was tracked by a `setInterval` inside `StyleManager`:
walking to another screen tore it down, and fourteen chapters were rewritten
with nothing anywhere saying so. Anything that enqueues a job gets the rail
card for free — do not add a second, page-local tracker.

## How the UI is styled

Three stylesheets in `vendor/studio/packages/studio/src`, three jobs:

- `vermilion.css` is the design system: tokens (colour, the type lock
  `--fs-*`, radii `--r-*`, shadows `--e*`, motion `--fast/--med/--slow/--ease`),
  every component class (`panel`, `btn`, `input`, `row`, `tabs`, `gate`,
  `fail`/`caution`/`notice`/`pass`, `well`, `pill`, `arc`, `bar`, …) and the
  app shell. The shadcn names (`--primary`, `--card`, …) are pointed at these
  tokens on `:root`, so there is one palette with two vocabularies.
- `motion.css` is the whole motion language plus the four working states
  (searching, planning, thinking/writing, generating). Reduced motion ends
  every animation where it was going.
- `index.css` only wires things together: fonts, Tailwind, and Tailwind's
  theme pointed at the tokens (`text-cap`, `text-body`, `rounded-xl` = card,
  `max-w-measure`, one easing). It cannot be deleted: it is Tailwind's entry.

Both system files are imported into the `components` layer, so a Tailwind
utility on an element beats the component class beside it, which used to be
the job of inline `style={{}}`. Pages use component classes plus layout
utilities. The working states and progress are React components in
`components/ui/working.tsx` (`Working`, `Spinner`, `Ring`, `Bar`).

`src/__tests__/ui-guard.test.ts` holds pages and components to zero literal
inline styles, zero `[12px]` sizes, zero hex colours and zero Tailwind palette
colours. The style guide (`#/styleguide`) renders all of it.

Don't name a component class after a Tailwind utility: utilities win the
cascade. The progress ring is `.arc` for that reason, since `ring` is Tailwind's.

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

**A confirmed run is not a chat round, and only Stop ends it.**
`CONFIRMED_PRODUCTION_INTENTS` in `shared/confirmed-production.ts` is the list
that decides this; an intent missing from it runs as an ordinary chat round
instead. That is what happened to `publication_create`: a confirmed magazine
ran as chat, and opening another conversation cancelled it a few seconds in,
leaving an aborted transcript and nothing on disk. Two rules now hold:

- Reading another conversation cancels nothing. `activateSession` used to abort
  the round it was leaving; it no longer does, so navigation, a new session and
  the Daemon screen all leave running work alone.
- Stop reaches the run. `POST /sessions/:id/abort` aborts the task's
  controller, and the publication tool passes that signal to
  `createPublicationAsk` and to `run` in `publication-runner.ts`, which check it
  between stages and between pages. A stopped run ends as "Stopped by you."
  rather than as the raw "This operation was aborted".

The proposal card follows the run it started (`proposalRuns` in the chat store)
and reports Running, The run finished, or The run failed. It used to print a
tick and "Executed" the moment the button was pressed, which stayed there while
the run behind it died.

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
