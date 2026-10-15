# What exists, and where

A map of the load-bearing parts, kept so a change can start from what the code
does rather than from a guess about it. Every entry here was read out of the
file it names.

**Update this file in the same change that makes it wrong.** A stale map is
worse than none: it is a guess wearing the clothes of a fact.

## Two installs, one machine

| | folder | shim | studio | workspace | settings |
|---|---|---|---|---|---|
| dev | `~/IDEAVERSE/Quire-Dev` | 8788 | 4568 | shared: `~/IDEAVERSE/Output` | `~/.quire-dev` |
| prod | `~/IDEAVERSE/Quire-Prod` | 8787 | 4567 | shared: `~/Quire` (a junction to Output) | `~/.quire` |

**The work is shared; the settings are not.** Both apps read and write the
same issues and books. Each has its own models and routing, keys, MCP,
connections, chat sessions, tasks and log. See "Settings" below.

Ports are compiled in: `desktop/build-dev.mjs` sets `QUIRE_SHIM_PORT` /
`QUIRE_STUDIO_PORT`, read by `option_env!` in `desktop/src-tauri/src/main.rs`.
`main.rs` passes both to every child it spawns, which is what makes the shim
port usable as an install identity.

`desktop/quire-ctl.mjs` is the only way to drive either one:
`node desktop/quire-ctl.mjs <dev|prod> <path|up|down|status|chat> [json]`.
Under Git Bash a leading `/` is rewritten to a Windows path — prefix with
`MSYS_NO_PATHCONV=1`.

## Names

Quire's own names only: the app's settings folder (`QUIRE_CONFIG_DIR`, see
"Settings") for `quire.json`, `.env`, `mcp.json`, `secrets.json`,
`connections.json`, `providers.json`, sessions, tasks and the log;
`<workspace>/.quire/` for state about the work (uploads, research reports,
the search index, findings, audit state); `<workspace>/research/` for
gathered pages; `~/.quire/workspace.<instance>.json` for the workspace
pointer; `QUIRE_*` for environment settings, `quire` for the CLI.

## MCP servers

`~/.quire/mcp.json` is the one list, in the `{ "mcpServers": {} }` shape every
other agent uses (`cli-shim/mcp.mjs`). The bundled `quire` server is always
added on top. Servers other agents have are detected and added at shim start
and on Rescan (`POST /mcp/rescan`): Claude Desktop (classic and Store install,
plus its extensions), Claude Code (user and per-project), Codex, Devin, Cursor,
Windsurf, Antigravity, Gemini CLI, VS Code. Detection only adds: an entry
already in the file is never rewritten, and one removed (`POST /mcp/remove`,
kept in `removed`) never comes back. `POST /mcp/add` takes pasted JSON (a whole
`mcpServers` block, a name map, or one entry). Remote `url`-only servers are
refused: only command-started (stdio) servers can run. Page: MCP.

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

## Settings

`cli-shim/workspace.mjs` sets `QUIRE_CONFIG_DIR` before anything is spawned:
`~/.quire` for prod, `~/.quire-<instance>` for any other install. Core reads it
through `core/src/utils/config-dir.ts` (`configFile`, `configDir`, `stateDir`)
and `GLOBAL_CONFIG_DIR`; nothing may join `quire.json`, `.env`, sessions or
tasks onto the workspace root directly. Unset (the CLI on a project) it falls
back to the project, as before.

`adoptSettings()` runs once per start and never overwrites: it copies
`quire.json` and app state out of a workspace that still holds them, and a new
dev folder starts from prod's (`mcp.json`, `connections.json`, keys, `.env`).

Why: the settings lived in the workspace, so dev and prod shared one model
routing, one set of sessions - and a run's owner was unknown, so one app
booting marked the other's live run interrupted. Run files
(`<production>/pipeline.json`) stay with the work, and carry the owning pid
while running; `markInterrupted` skips a run whose owner is alive.

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
- API keys — `~/.quire/secrets.json` (`core/src/llm/secrets.ts`). A workspace's
  old `.quire/secrets.json` is moved there on first load. Under vitest the store
  stays in the test's temp root, so tests never touch the real home.

## Connections: what "connected" means

One rule, in `studio/src/api/connections.ts` + `serviceAvailability()` in
`studio/src/api/server.ts`: a connection is connected when a test made a real
call and the provider listed at least one model. The result is stored with its
time in `~/.quire/connections.json` (pass trusted 5 min, failure 1 min, then
re-tested in the background). Only connected providers reach the model list
(`/api/v1/services/models`), the routing snapshot, or a run.

- What is offered: `core/providers.json` (kinds `api | cli | local`, ids name
  endpoints in `core/src/llm/providers`), plus `~/.quire/providers.json` over it,
  plus any provider holding a key, plus custom services from `quire.json`
  (a custom URL on loopback counts as local).
- How each kind is tested: API — `probeServiceCapabilities` with the key; CLI —
  shim `/agents` (installed, enabled, not signed out) then its `/<cli>/v1/models`;
  local — its `/v1/models`. Never-tested rows are tested on the first list; CLIs
  one at a time.
- `POST /api/v1/connections/:id/test {apiKey?}` keeps a key only if it passes.
- A failure after a pass keeps `lastOk`; `stoppedAnswering()` shows those greyed
  with the reason in `ModelCombo`. Never-set-up ones are not shown there.
- The screen: Settings → Connections (`pages/Connections.tsx`). `#/services`
  and `#/services/<id>` land there; the old Services pages are gone.
- The shim's `/agents` runs each CLI's sign-in check synchronously and blocks
  the shim; it caches answers for 60 s, and Studio shares one ask per minute.
- **A CLI whose real calls fail is not connected.** Listing models is not a call: Claude Code listed
  its models while every call died on a dead `ANTHROPIC_BASE_URL`, so its test passed and a preset
  could route to it. The shim keeps the last real call per CLI (`callHealth`): one that failed as
  `upstream`, `auth` or `cli-missing` is reported by `/agents` as `failing` for 10 minutes, and the
  connection test fails with its reason; any good turn clears it.

## The model catalogue

`listModels()` in `cli-shim/server.mjs`. Per CLI, `a.models(a.bin)`; on an
empty result it substitutes `a.fallback`, a small static alias list.

Devin's real catalogue (~197) only exists over an ACP session — `acp()` spawns
the CLI with `cwd: WORKSPACE` and sends `session/new`. That session is slow on
the first call after a restart, so the 8-alias fallback stands in. Cache TTL is
therefore 300s for a live listing and 15s for one that fell back, so a cold
start heals itself instead of reporting 33 models for five minutes.

`GET /v1/status?fresh=1` forces a rescan.

**Which CLIs exist is data (2026-10-07).** `cli-shim/server.mjs` `loadAgents()` reads the cli
entries of core `providers.json` (staged copy first, source checkout second), then
`~/.quire/providers.json` field by field. An entry carries `protocol` (acp · plain ·
claude-json · codex-json), `bins` (`~` and `%VAR%` expand, `*` globs), `acpArgs`,
`fallback`. The shim agent id is the catalogue id without `Cli`. `QUIRKS` holds only
what cannot be data (claude/codex/devin/agy sign-in checks, model listings, args); a
CLI without quirks runs on its protocol, so an ACP agent is one JSON entry. Core builds
one endpoint per cli entry (`cliEndpoints()` in `providers/endpoints/cliAgents.ts`),
and preflight lists what the shim detected. The last live list per CLI is kept in
`~/.quire/cli-models.json` and served before the static fallback on a cold start.
One ACP process per run is kept on purpose: a shared one would change how Stop works.

**Claude Code ignores the shim env filter for `~/.claude/settings.json` (2026-10-07).** That file
can carry an `env` block (here `ANTHROPIC_BASE_URL=http://localhost:11434`, Ollama), which the CLI
applies itself, so a run hung retrying a dead URL and `claude auth status` reported signed in
on that file's key. `CLAUDE_SETTINGS` in `cli-shim/server.mjs` is passed as `--settings` (before the
subcommand for `auth status`) and outranks the user file, so the shim's claude uses the user's own login.

## pi 1.0

`@earendil-works/pi-ai` + `pi-agent-core` 1.0.4 (was `@mariozechner` 0.67.1), and
`typebox` 1 in place of `@sinclair/typebox`. What changed under us:
- The old global API (`getModel`, `getEnvApiKey`, `streamSimple`, `completeSimple`) lives
  on `@earendil-works/pi-ai/compat`, which pi says will be removed. `provider.ts`,
  `pi-stream.ts`, `agent-session.ts`, `service-resolver.ts` import from it; tests that
  mock pi must mock `/compat`. Moving to `createModels()` is the upgrade path.
- The agent loop hands a stream function a transcript whose **system messages carry
  the prompt and the tool declarations** (`toolsAdded`), not `context.systemPrompt` /
  `context.tools`. `convertAgentMessagesForModel` used to drop them and every chat turn
  would have gone out with no prompt and no tools; it now passes system messages
  through (test: "hands the model its system prompt and its tools").
- `Static<any>` is `unknown` in typebox 1; tools typed at their own `execute` use
  `LooseAgentTool` (agent-tools.ts).

## Connect via (Anthropic, OpenAI)

`core/src/llm/subscription.ts`. Per provider, `~/.quire/connect-via.json`: `api-key`
(default), `subscription` (Claude Pro/Max, ChatGPT, signed in through pi's OAuth; tokens
in `~/.quire/credentials.json`), or `cli` (the installed Claude Code / Codex through
the shim, as `claude/<opus|sonnet|haiku>` or `codex/<id>`). Applied in `viaStream`,
the one transport both `chatCompletion` and the agent stream use, and only for
requests to api.anthropic.com / api.openai.com, so a gateway pi calls "openai" is never
sent to a ChatGPT login. A subscription or CLI connection needs no key:
`getServiceApiKey` returns `SUBSCRIPTION_KEY`, which `viaStream` never sends.
Studio: `PUT /api/v1/connections/:id/via`, sign-in `POST|GET|DELETE
/api/v1/connections/:id/login` + `POST .../login/code` (`api/subscription-login.ts`);
the Connections row has a Connect-via select and a Sign in button.

## Presets (who uses what without a pin)

`core/src/llm/model-presets.ts`: a card per connected model (reasoning, speed, cost,
context, vision, web: from pi's facts where known, the name otherwise), `AGENT_NEEDS`
per agent, and `pickForAgent` for Best · Balanced · Frugal. `resolveAgentRoute` is
pin → preset → default, with a `reason` the routing page shows. `quire.json
modelPreset`; absent routes exactly as before. Studio builds the cards in the routing
snapshot only when a preset is set (listing models is a probe) and hands
`modelPreset` to every run; the runner carries a preset choice out like a service pin.
A production's own pins live in its `pipeline.json` `modelOverrides` (`PUT
/api/v1/productions/:type/:id/model-overrides`) and win over the project's.

## Run telemetry and the budget

`core/src/llm/telemetry.ts`. `runStage` runs each unit inside `withRunMeter(runDir)`
(AsyncLocalStorage); every call inside it is appended to `<runDir>/_telemetry/llm.jsonl`
by `chatCompletion` (pipelines) or the stream guard (agent turns), with the agent
named by `asAgent` (BaseAgent, publication stages). Cost is list price × tokens; CLI
and local calls cost $0 but count tokens. `quire.json budget {perRunUsd?,
perRunTokens?}` is checked before each unit against the in-memory total; over it, the
run is paused (idle, `run:cancelled` with the reason as its note, `stage:blocked`
emitted), not failed, so resume picks up the unit. The ceiling is between units: one
unit can overshoot by its own cost. The Run screen shows spend and "who wrote it"
(agent · model pills) from `GET /api/v1/productions/:type/:id/pipeline` (`spend`,
`budget`, `who`); the routing page sets the preset and the ceiling.


**Per-production pins (2026-10-07).** The Run screen's "Models for this production" panel
(`pages/RunPins.tsx`) writes `PUT /productions/:type/:id/model-overrides`; the pins live in the
run's pipeline state and win over the project's for that run only. The run meter is cached in
memory per run for the life of the process (`telemetry.ts` `meters`): it reads the file once, so a
telemetry file edited from outside while Studio runs is not seen until restart.

## Gates that enforce (Phase 3)

- **Blocking categories.** An audit pack's `blocking` list is read by `holdsGate(pack, finding)`
  (`core/src/pipeline/audit-pack.ts`): a finding holds a gate when it is rated blocking or its
  category (or the family above it, `readability` for `readability/grade`) is listed and not
  silenced. The magazine copy gate uses it: `gateState(issue, pack, math)` in
  `studio/src/api/publications.ts` puts such findings in `copy.blockers`, `canApprove` goes false,
  and `POST /publications/:id/approve` answers 409 with them. The Audit sync rates them blocking in
  the findings queue too, so counts and the gate agree. The pack an issue resolves to is
  `publicationPack(root, id)`. Warnings (pages unwritten, not audited) still do not block.
- **Reader personas** follow the work's audience field (`personasFor(type, audience)`,
  `reader-sim.ts`): the two adult readers are readers of that audience, and a young audience, or any
  storybook, adds the listener named for the age. `workAudience()` in `api/audit.ts` reads it from
  `storybook.json` or `publication.json`.
- **Golden rules and number rules** are `pipeline/design-rules.ts`. `goldenRules(spec, sections, math)`
  checks what a spec can answer on its own: full-bleed runs, declared breaks per section
  (`PageLayout.breaks`), blocks per page. It runs in the design stage, in `build`, and in the design
  gate. Whitespace and dominant share are kept as numbers but are measured on the render (Phase 4).
  The numbers live in `<workspace>/_taste/math.json` by scope (`global`, `type:`, `world:`,
  `work:`), read layered by `readMath`. Accepting a taste proposal of kind `number` parses it
  (`parseNumberRule`) and writes it; one the checker cannot hold stays a prompt line and the answer
  says `enforced: null`.
- **Taste evidence** is the passage, not the title: an audit verdict records `passage` (the finding's
  quote), `GET /taste/proposals/:id/evidence` lists them, and the Taste page shows them under the row.
  A verdict recorded before `passage` existed is given the quote of its finding, found in
  `.quire/findings.json` by file (`target`) and title (`note`); none only when the finding is gone.

## The page score (Phase 4)

Three halves, one score. **The shim measures** (`cli-shim/score.mjs`, routes `POST /score/measure` and
`/score/asset`): pure Node over `postprocess.mjs`'s PNG codec, no model. A render gives the share of each
declared colour (nearest role in OKLab outside the image frames), the share off palette, whitespace
(16px cells that are all paper), and balance (weight centroid from the optical centre, as a fraction of
the half-diagonal). A picture gives subject fill, halo share (half-transparent pixels with nothing solid
within 2px), distance from the world's palette, and dpi at the slot size. **Core scores**
(`pipeline/page-score.ts`): `scorePage` turns those and the spec's own checks into the seven dimensions
(G H W C T I R), the weighted total per type, a cause (lowest dimension, named with its worst
sub-metric) and the fix that cause routes to (repair / re-archetype / recolour / redo-image).
`improvePage` runs that at most twice. **Core runs it on an issue** (`pipeline/page-score-run.ts`):
`scoreIssuePage` reads what exists for a page, and `layoutScored` is what the layout stage
(`executors.ts` `layout`) runs per page: place, render to `<issue>/pages/<nn>/render.png`, score, and on
a failure mend by cause and lay it out again, twice at most. **Studio** only joins it to an id
(`api/page-score.ts`): `POST|GET /publications/:id/pages/:n/score` (`{layout: true}` runs `layoutScored`),
`POST /publications/:id/improve-spec`.

- **Where G, H and T come from.** Every frame the one-page script places is tagged `mag-p<n>:<role>`
  (ground, image, title, deck, pull, body, folio). INSPECT reports each frame's box with its role, the
  grid (`x0`, column, gutter) and its findings; `buildPage` adds `leaks` (markup that reached Affinity,
  checked on what `bodyItems` handed over) and `pourBalanced` adds `cols` (words per column, overset).
  `placePage` keeps that as `<issue>/pages/<nn>/layout.json`. G: overlapping text frames, type outside
  the live area, frames off the column grid. H (design-skill §12b): the leading picture, head, pull or
  deck holds 40-60 % of the page's visual weight (`dominantMin` lowers the floor), a rival at 80 % of
  its weight competes, the body starts above the head. Weight is area x contrast against the paper,
  measured per frame on the render by `/score/measure` (`boxes` in, `weights` out); body text counts in
  the whole but is never the dominant. T adds leaked markup, overset words and unbalanced columns.
  INSPECT reads text-ness from the role tag: on 3.3 a plain rectangle has a `lineBox` too, and the
  paper ground was reported as a text frame overlapping every other one (the five "overlaps" on p.8).
- **C is an order, not pixel shares.** 60-30-10 is checked as dominant > secondary > accent and an
  accent kept under 1.5x its share. The first version compared pixel shares and blamed colour on every
  text page, where body text is ink but covers a tenth of the page.
- **What a cause can mend on its own.** `repair`: `repairGoldenRules` on the spec, or a smaller picture
  band when the words overset. `re-archetype`: a `PageVariant` written to `spec.pages[n].variant` and
  honoured by `onePageScript` (`small-band` / `large-band` picture band, `pull` leads a text page with
  its pull quote, `big-deck` with its standfirst), never the same one twice. `recolour` and
  `redo-image` are not automatic: a world's colours are the person's, and pictures wait for Phase 7.
  `math.minWhitespace` and `math.dominantMin` reach the score as the W floor and the H share.
- **Verified live (2026-10-07, Affinity 3.3, a copy of Photography p.8).** Laid out, rendered and scored
  in 30 s; G 100, T found no leaks and columns of 230/226 words. Under the first H rule (12 % of page
  area) it failed on H, was given its pull quote as lead, laid out again and passed 76 -> 87; under the
  documented rule it passes at 80 with H 62 ("nothing dominates") and no redesign. Without a picture
  (Phase 7) no arrangement gives it a dominant.

- One function, three checkpoints: `spec-lint` (no render), `asset-check` (pictures), `page-score`
  (a render at `<issue>/pages/<nn>/render.png`). Which runs follows what exists.
- **A dimension nothing measured is `null`, never 100**; the total is over the measured ones with their
  weights renormalised, and `unmeasured` lists the rest. G and H are measured only once the page has
  been laid out (`layout.json`). A total of 100 on a page with five dimensions unmeasured means
  "nothing found wrong in what was checked", not "a good page".
- Stored per page at `<issue>/pages/<nn>/score.json` (latest + history, last 40). Machine verdicts go to
  `_taste/score.jsonl`, not `feedback.jsonl`: a machine "redo" must not count against a rule on trial.
- `repairGoldenRules` (`design-rules.ts`) mends a spec without a model (ends a full-bleed run, drops
  surplus breaks, trims blocks). The design stage runs it before refusing a spec, and
  `improve-spec` runs it by cause. It writes `publication.json` directly.
- `renderPage` (`cli-shim/affinity.mjs`) was verified live on Affinity 3.3 (2026-10-07): open, build
  page 1, render gave a 2481x3508 PNG that `/score/measure` read in 1.6s. Two things it found:
  `doc.export` without a `FileExportArea` writes every spread as `name_N.png`, so the call now passes
  `createForSpreads("<n>")` and renames a numbered result (old renders are deleted first: Affinity does not
overwrite, so a re-render went to `name_1.png` and the stale picture was scored); and `document.metadata` is gone on 3.3, so
  the old `QUIRE-BUILD` title marker never matched. The build document is now found by its
  `sessionUuid` (kept on the session), and `openIssue` reuses the open document for the same issue
  instead of making one per page. A page built from a design spec was then rendered live (Photography
  p.8) and found two more faults, both fixed: `tk.js` reassigned its own `text()` to a font name when a
  spec named a text face, so no frame could be built on a designed issue; and the body was poured as
  flat words, so markdown `###` reached the page and the right column stood half empty. The copy is now
  parsed in Node (`bodyItems`: words that know their paragraph and whether it is a heading) and poured
  by `FLOW_JS`, shared by `layoutScript` and `onePageScript`: headings in the display face, never last
  in a column, and `pourBalanced` finds the shallowest column foot that still holds all of it.

## Pages built from blocks (Phase 5)

`vendor/studio/packages/core/src/pipeline/page-blocks.ts` · `cli-shim/affinity.mjs` (`blocksOf`, `blockPage`) ·
`cli-shim/affinity/tk.js` (`blockGrid`, `fitText`, `drawn`) · plan: `analysis/25-pages-from-the-spec.md`.

- **A page is its blocks.** `spec.pages[n].blocks` is a list of `{kind, slot}` from a closed vocabulary
  (`image drawn figure title deck kicker body dropcap pull panel runhead wordmark rule folio`). A slot is
  grid arithmetic: `{col, span, row, rows, bleed?}` in columns and baselines of the spec's grid
  (`gridOf`: symmetric `marginMm`, `columns`, `gutterMm`, `baselineMm`; depth `(297 - 2m - 10) / baseline`).
  A prose slot (`"col-10-12-upper"`, every design made before Phase 5) is a legacy block: kept, never
  placed. `onePageScript` builds from blocks only when **every** block of the page has a grid slot;
  otherwise the page type's own arrangement runs as before, on the house 6-column grid.
- **Content comes from the page.** `figure` reads the `pull-number` furniture (`"11,871 mm / year — caption"`
  → value, unit, caption: `figureOf`); `panel` reads `sidefact`/`did-you-know` as label/value rows
  (`notesOf`). `wordmark` and `runhead` read `issue.series`. Brand furniture that sits on every block page
  is `design.fixed.blocks` (a page's own block of the same kind wins).
- **The design stage asks for them** (`DEFAULT_DESIGN_PROMPT` "PAGE BLOCKS") and is told the installed
  faces (`GET shim /affinity/fonts`, read once per shim run, never launches Affinity). A block the builder
  cannot place is **dropped and said** (`cleanBlocks`, a progress line), never thrown: the design stage
  throws on a spec problem, and one bad slot must not cost an issue's design. The drop cap is the one
  block allowed to sit inside another (its body).
- **The builder.** Pictures first (`image`; a stand-in frame while there is no picture; `drawn` = seeded
  contours and rain as vectors, cut at the box because the SDK cannot clip), then the rest in order.
  `fitText` searches size on overset, the only measure the SDK gives: the wordmark (display face at its
  heaviest, so the measure stops it, not the height) and the figure fill their slots. The drop cap is
  N body lines tall with the opening words in their own frame beside it; body pours balanced across
  `columns`. A face the spec names and Affinity lacks is a `warn:` finding (`TK.MISSING`).
- **What the score reads.** Strokes inside drawn art are tagged `art` and left out of the frames (the
  field is the frame). INSPECT uses the block grid for the live area. New roles join G (grid), H (`drawn`
  and `figure` can lead) and the overlap check. `blockRules` (spec-lint, per page): type sizes under
  `minScaleStep` (1.2x) apart (H), each block of type against the ground it sits on — the picture's field
  when over one — at 7:1 body/deck, 4.5:1 labels, 3:1 display (C), a `crosses` with no declared break (G).
  Line length 35-75 characters from column width and body size (T, `measureMin`/`measureMax`).
- **Not automatic on block pages:** re-archetype variants rearrange a type's default arrangement, so a page
  built from its spec is left to the designer (`stopped: "no-fix"` with its cause).
- **Verified live (2026-10-07, Affinity 3.3).** The fixture `cli-shim/fixtures/petrichor.publication.json`
  (the PETRICHOR reference page as content + spec; copy it to `<workspace>/Magazine/issues/petrichor-fixture/`)
  builds page 3 from blocks in ~30 s and scores 99, no findings. Not yet verified: a design written by the
  model with blocks. The pipeline cannot stop after `design.artplan`, and `design.generate` uses the GPU (Phase 7).

## The beauty gate and the section board (Phase 6)

`vendor/studio/packages/studio/src/api/page-review.ts` · `components/BeautyGate.tsx` (Proofs tab) ·
`pages/PublicationDetail.tsx` (Sections tab) · core `publication-runner.ts` (`markSection`,
`redesignPage`, `appendReview`, `readReviews`) · `taste-engine.ts` (world scope).

- **Page bundle, assembled not migrated.** `GET /publications/:id/pages/:n/bundle` reads the page and its
  spec from `publication.json` and the rest from `pages/<nn>/` (`layout.json`, `render.png`, `score.json`,
  `reviews.jsonl`). Moving content and spec into the folder (13 data model) was not done: one file stays
  the source, and nothing needed the move.
- **Section board.** `POST /publications/:id/sections/:n/mark {state: approved|locked|null}` writes
  `issue.sectionBoard`. A locked section refuses another world (`designSection`, the route and the
  verdict all say 409/throw) and keeps its world through a design run. The board shows each section's
  mark, its opener as rendered (when laid out), its beats and the first written page's copy.
- **Proofs (the beauty gate).** One rendered page at a time (J/K), the score card (seven dimensions,
  cause line, notes, history) and four verdicts: keep, redesign, re-world, tweak. The "what went wrong?"
  chips are the score's seven dimension names. `POST .../pages/:n/verdict` writes the page's
  `reviews.jsonl` and the taste stream (`surface: design`, `scope.world` = the section's register), then
  for anything but keep queues a job: **redesign/tweak** = `redesignPage` (one model call for this page's
  blocks, told the old blocks, the causes, the note and the world's rules; unplaceable blocks dropped and
  said) then `layoutScored`; **re-world** = `designSection` for the page's section, then the page laid out
  again. Regenerating art waits for Phase 7.
- **The sign-off stands through a gate redo.** Layout requires the design approved; the beauty gate is
  where it is approved page by page, so a redesign or re-world asked for there keeps
  `designApproved` (`keepSignOff`). A re-world from the Sections tab still clears it.
- **Taste per world.** `applies()` honours a `world` scope key; `rulesFor` takes `world`; `causeProposals`
  groups negative verdicts carrying `scope.world` per world (weight 5 proposes `{surface, world}`).
  `CAUSE_RULES.design` gained the seven dimension chips. `redesignPage` reads the world's rules.
- **Score changes found live.** Overset words fail T past a dozen (`30 + 2 x words`, max 60); the mend
  loop grows a block page's body down to the grid foot when its columns are free (`growBody`). The notes
  panel is drawn as tall as its rows, and carries the page's figure when it has no figure block.
- **Verified live (2026-10-07, Affinity 3.3, PETRICHOR fixture).** Bundle before and after layout,
  `render.png` served, lock refused re-world (route and job), keep recorded in both streams with
  `scope.world`; a tweak and a redesign each ran the model (~2 min), which wrote valid blocks, laid
  out and scored 98 and 89; the 89 had 21 words overset, now caught (T 40) and mended to 96. UI measured
  at 1440, 746 and 375 px: page column 675/482 at 1440, one column below, no horizontal overflow.

## The house and the layout engine (Phases 7-8)

Plan: `analysis/26-design-engine.md`. The brand is a grammar, not a look: the
house fixes what never changes, a section's world picks how it looks, and the
model chooses while code computes.

**House book.** `<brand>/house.json` (the magazine's output folder, so every
publication type writing there shares it):
- what it holds: masthead, type pair, scale (body x ratio), paper and ink,
  margin, gutter, baseline, the grid systems allowed, the devices (panel and rule
  style, folio, kicker), and the art styles it carries
- code: `core/src/pipeline/house.ts`, routes `studio/src/api/house.ts`
  (`GET/PUT /api/v1/house`, `POST /house/propose` (a model job), `POST /house/approve`),
  screen `pages/HousePage.tsx` (rail: House)
- any edit makes it a draft again; only an approved house binds the design stage
- approval refuses when Affinity is closed: the faces are checked against
  Affinity's installed list, and an unchecked face would fall back in every build

**Art styles.** The builtin library is `core/art-styles/library.json` (10 styles),
with the workspace's `art-styles.json` layered over it by id. A style has:
- a register and technique from the STYLES catalogue, and the domains it suits
- its generators, a field rule (paper · tint · ink · accent-tint), and a ComfyUI prompt and negative

**Design under a house.** `runDesign`:
- tells the model what is fixed (`houseBlock`) and asks for an accent, a
  `grid.system` and a `style` per section
- `applyHouse` then enforces the house: the type, paper, ink and scale come from it,
  each world's field from its style, and an unknown or neighbouring-duplicate style
  is a design problem
- `fixed.masthead`, `fixed.panel` and `fixed.rule` carry the house to the shim
- with no approved house the stage behaves as before and says so

**Layout engine.** `core/src/pipeline/layout-engine.ts`:
- `geometryOf(spec)` makes cells and baselines for `columns` · `modular` (6 x 8
  fields) · `thirds` · `golden` (.382 / .236 / .382) · `canon` (Van de Graaf:
  inner 1/9, outer 2/9, head 1/9, foot 2/9; recto and verso differ; the note cell
  is last)
- `PATTERNS` holds 36 patterns, each tagged by system and role (cover, back, opener,
  feature, figure, timeline, closing). Blocks are cells across and fractions of the
  depth down
- the model returns `pattern`, `mirror`, `art`, `seed`, `kicker` and `panelTitle` per page
- `resolveLayouts` → `choosePattern` → `resolvePattern` → `settle`:
  - fits the copy with a conservative capacity estimate, and prefers a pattern the copy fills (≥ 60 %)
  - skips figure patterns on pages with no figure, and avoids repeating the previous page's pattern
  - sizes titles and decks to their slots
  - gives a short page's spare lines to its top art band
  - adds the running head (never on covers)
- every block carries its mm `box` and every page its grid `edges`; the shim draws
  the box, and the score checks alignment against the edges
- a page the model placed by hand (blocks, no pattern) keeps its blocks; the
  one-page redesign offers patterns first

**Shim.**
- `T.drawn` (tk.js) has 13 seeded generators: contours, rain, rings, flow, hatch,
  halftone, burst, spiral, hex, tri, voronoi, blobs, bauhaus. Positions come from the
  seed, at most one accent mark is drawn, strokes stop short of type sitting on the art,
  and each page is capped at 900 nodes
- `T.rule` draws the house's rule style
- `blockPage`:
  - type on art picks ink or paper by contrast; deck, pull and panel values are fitted
  - panels follow the house style
  - covers carry no running head or folio, and front and back matter wear the
    first and last section's world (`worldOf`)

Live, 2026-10-08:
- the house "Filament" (Zodiak / Sitka) was drafted by the model and approved
- the contour-maps folio rebuilt to 88 · 88 · 91 · 90 · 87 with no findings
- a copy of Kolam took three styles across its three sections (Wabi earth,
  Bauhaus primer, Field notes) on the modular system under the same house, and its
  pages scored 92 · 88 · 88 · 89

## Pages Quire makes right itself (Phase 9)

`core/pipeline/page-look.ts` · `page-score-run.ts` (`perfectPage`, `perfectIssue`) ·
`publication-runner.ts` (`makePagesRight`, `unprovenPages`, `forkIssue`) ·
`publication-session.ts` (`look`) · shim `server.mjs` (`imagesOf`) · skill
`quire-editorial-design` §14-15.

- **The eye.** `lookAtPage` shows the model the page's `render.png` (tag `design-look`, so it
  answers under the editorial-design skill) with the page's facts: how the story ends (so cut text
  is seen), the world, the direction, what Affinity measured and the editor's rules. It answers
  `{first, score, dims, defects[{severity, what, where, fix}], lesson}`; `parseLook` fails any
  fatal fault whatever the score, and a page passes at `LOOK_PASS` 85. Kept per page in
  `pages/<nn>/look.json` (latest + 40), stamped with `layoutHash` of the composition judged.
- **Images reach the model.** `AskFn` takes `{images}`; `createPublicationAsk` then makes one
  chat call straight to the stage model's endpoint with `image_url` parts (the worker path is
  text-only). The shim's `imagesOf` reads them: ACP CLIs (Devin) get `image` content blocks,
  stdin CLIs get the files on disk named in the prompt. Verified live 2026-10-10: Devin
  swe-2-high read Rain p2's title and its cut last words from the render in 18 s.
- **The loop.** `perfectPage`: `layoutScored` (place, render, pixel score, cause mends) → eye →
  while pixels fail, Affinity measured an error, or the eye fails: `redesignPage` told every fault
  and its fix, at most 3 redesigns. The best round stays (laid out again if a later one was worse).
  A page whose latest look passed on its current composition is skipped. Lessons go to
  `_taste/proposals.jsonl` as pending proposals (`proposeLesson`, deduped against proposals and
  rules); accepted, they reach the composer and the eye through `rulesFor`.
- **The gate.** The build stage (`build.export`) runs `makePagesRight` first and stops, naming
  each page's faults, when one cannot be made right. `build()` refuses any page whose proof was
  never looked at, failed, or was of another composition (`unprovenPages`).
- **Measured errors added.** INSPECT now makes a body that oversets (`cols.overset`) an error
  naming the body, and two text frames overlapping by more than 10 mm² (was 40) an error.
- **Routes.** `POST /publications/:id/perfect {pages?, rounds?}` (a job);
  `POST /publications/:id/fork` copies the approved copy, research and memory into
  `<id>--l<k>` without design, art or build, to be designed in another language
  (`recentBlock` keeps it from repeating the others).
- **Knowledge.** `quire-editorial-design` 2.2.0 adds §14 Seeing the proof (the order an art
  director reads a proof in and what each fault costs) and §15 Design languages (a vocabulary
  of languages and the decisions that make each one); the composer and the eye both read it.
  2.3.0 adds §16 The minimal editorial standard (read off a reference set of minimalist
  magazine pages): few elements, one dominant, extreme type contrast, 35-75 character measure,
  white space as one zone never holes, shared edges, grid-cropped pictures, paper not tint, and
  display/text/label pairs that are installed in Affinity. The eye names a break of it as major.
- **The eye has its own agent.** Tag `design-look` routes to `publication-critic` (job "Design
  critic"), not the designer, so it can be pinned to a model that sees without moving design.
  Dev pins it to `antigravity/gemini-3.1-pro-high` (tested 2026-10-10: read Rain l2 p2's title
  and last words from the render in 51 s). Note: a shim model id needs its provider prefix -
  a bare `gemini-3.1-pro-high` silently falls back to the default model.
- **Reference pages.** Images under `<Output>/_taste/references/<set>/` (shared by both apps) are
  the editor's standard. `referencePages` sends the eye three of them after the proof, rotated by
  page number, and the prompt says to judge against their level, not copy them. The first set,
  `minimal-editorial`, is 14 pins from a Pinterest "minimalist magazine design" search
  (`SOURCES.txt` lists each URL).
- **Several looks are options of one creation, never forks.** `issue.designCount` (1-4, set by
  `POST /publications/:id/resume {designOptions}` or the Build tab's "designs to choose from")
  makes `runDesign` call `designOne` that many times; each later option is told what the earlier
  ones chose (`optionsBlock`) and shown a different few reference pages (`referencePages`,
  newest set first). All options are kept in `issue.designOptions`, the first is `issue.design`;
  `POST /publications/:id/design/choose {option}` (`chooseDesign`) makes another the design and
  drops the sign-off. The issue page shows them above the tabs as "Design options". An option
  that does not hold up is reported and skipped; the stage fails only when none does.
  `/fork` still exists but is not how looks are compared (Rain's three forks were retired to
  `Magazine/_removed/`).
- **Design stops when stopped.** Composing and drawing check the run's signal between model
  calls (`PublicationStopped`); before, a cancelled design ran on through every page.
- **The designer sees the references.** The design call carries the reference images (four per
  option) beside the prompt, so it goes as one image call to the designer's model.
- **The composer is held to the standard** (`checkComposition`): a body line over ~78 or under
  30 characters, more than two of pull / figure / panel, and an empty band across the page
  between frames (over 8 % of the rows) are each sent back before anything is rendered.
- **Fixes the loop needed.** The hill-climb redesigns from the best round, not the last
  (`perfectPage`); art faults reach the artist (`drawArt` note); `cleanBlocks` drops a pull or
  panel that sits on the body or title, never the body; a fork drops the issue's notes and
  reference images; fingerprints carry the worlds so a fork does not repeat them; a design whose
  type is not installed in Affinity (`installedFonts`, shim `/affinity/fonts`) is moved to the
  closest installed pair, or refused.

## Pages planned by arithmetic (the fast plan)

`core/pipeline/page-plan.ts` (`planPage`, `rerank`, `layoutOfPlan`) · `publication-runner.ts`
(`composePages`, `replanPage`, `pageSetting`, `installDesign`, `sizeForFrame`) ·
`page-score-run.ts` (`perfectPage`) · route `POST /publications/:id/design/install`.

- **Why.** The model composer placed every frame itself: ~18 sequential calls for one design of a
  four-page issue (Rain's three options took 67 min), and the frames it reserved left holes,
  because Affinity sets a text frame to its copy (Rain p1's body was planned 45 mm and laid 19).
- **The plan.** `planPage` lays a few editorial arrangements on the issue's own grid - picture
  across the head, across the foot, down one side (the system's minor/major spans) - with the
  title at full voice or compact, and none, one or two extras in a rail beside the body. Every
  frame is sized to what it carries (title rows at full size, deck lines, body words at the
  column count nearest 60 characters, +8 %). Spare rows go to the picture up to 62 % of the
  depth; past that they are one white zone at the head or foot, never a band between frames.
  Each candidate goes through `checkComposition` and is ranked by the page score's own numbers
  (one dominant at 40-60 %, title at full size, readable measure, few extras, not the
  neighbour's arrangement). `spec.composer: "model"` keeps the model composer; an editor's note
  (`redesignPage`) still goes to the model, since only words can carry it.
- **Planned pages carry a picture, and a drawn layer when the look layers.** `drawArt` (one model
  call a page) skips a page with `plan`; the picture slot is an `image` block, rendered at the
  frame's own aspect (`sizeForFrame`, ~1.5 MP in steps of 64) with the treatment its slot
  implies. When the issue's look layers colour, `layoutOfPlan` adds `layerShapes`: the drawn
  layer computed from the frames, no model call (see "Looks" below).
- **The visual loop walks the ranking.** In `perfectPage` a planned page's next round is
  `replanPage`: the best untried arrangement, re-ranked for what the proof lacked (`rerank`:
  crowded -> fewer extras and a bigger picture; empty space -> arrangements whose picture takes
  the slack; reading path -> picture out of the text's way). No model call; a round is a layout
  and a look. Every arrangement laid is remembered so none is tried twice.
- **Outside plans.** `installDesign` takes a whole design (spec with per-page blocks in grid
  slots) as one more design option: frames are checked and boxed from the grid exactly as a
  planned page, problems kept on the page rather than refused, pages it leaves out planned by
  Quire and said in the design notes.
- **Which routes can see.** Tested 2026-10-11 with Birds p6's render: Devin (ACP, images as
  content blocks) sees - `devin/gemini-3-1-pro-high` read the title in 17 s, Haiku in 13 s.
  Antigravity and Codex get the image as a file path and answer that they cannot open it, so the
  critic pin moved from `antigravity/gemini-3.1-pro-high` to `devin/gemini-3-1-pro-high`. Every
  eye score given through Antigravity before that was given blind.
- **Pictures cut to their frame and stand on the paper.** `tk.js img` clips a covering picture
  inside an empty rectangle at its box (a 0.5 picture in an 81 mm column was laid 148 mm wide over
  the body). A picture in a frame short of the whole page is a cutout (`artPage` `sharesPaper`),
  placed whole (`contain`), and the cutout key reads the ground the picture actually painted off
  its corner patches when it is not the colour asked for, with a tolerance as wide as its grain
  (`postprocess.mjs patchGround`). The art prompt is told the frame's shape and to face into the
  page (`placementOf`). `publication_art` redoes the page's picture (`artPage {redo}`) instead of
  keeping the old one.
- **The eye's model is recorded.** `look()` writes a telemetry row with the model it called, so a
  pin that fell back to the default can be seen in `_telemetry/llm.jsonl`.

## Brands: the fixed layer above the house

Added 2026-10-13. Without a brand every issue and section invents its own colours, faces and art
(house.ts drafts a house, visual-language.ts a palette per section, the recent-designs block forbids
repeating them). A work marked with a brand is held to it in code instead.

- **Where:** `vendor/studio/packages/core/brands/<id>/` (shipped: "brands" is in core's `files`, so
  vendor-studio stages it to `engine/node_modules/@actalk/quire-core/brands`). Ochin is the first:
  `brand.json` (colours, section colours, pairs by topic, contrast table, faces + ladder, house,
  shapes with meanings and rations, finish, image style, devices, voice), `DESIGN-SYSTEM.md` (the
  rules, injected into the design prompt and used as the critic's standard), `design-system.html`,
  `references/*.jpg` (Ochin 01 spreads, shown to the design stage and the critic), `fonts/` (OFL, for
  shaping), `kit/ochin-kit.js` (geo-lite + shapes.js + finish.js + ochin-shape-tool.js, built by
  `kit/build.sh` from `Output/Brand/photo-film`).
- **Set:** `issue.brand`, via `PUT /api/v1/publications/:id/brand {brand}`; `GET /api/v1/brands` lists
  them. The next issue of a series inherits it (`startNextIssue`). Applies from the next design.
- **Selected brand:** `<workspace>/.quire/brand.json {brand}` (`selectedBrand`/`selectBrand`); every new
  issue starts held to it (`createIssue`). The **Brand** page (`#/brand`, `pages/BrandPage.tsx`) selects
  it and shows the brand's `design-system.html` and reference spreads: `PUT /api/v1/brands/selected`,
  `GET /api/v1/brands/:id`, `/brands/:id/design-system`, `/brands/:id/references/:file`.
- **Core (`pipeline/brand.ts`):** `loadBrand`, `brandHouse` (the brand is the house; the series
  cannot redraft it), `brandBlock` (prompt), `pairOf` + `brandLanguage` (a section's colours are
  rebuilt from its two section colours; panels lose radius/cut/shadow/rotation), `holdBrandSpec`
  (palette, faces, ladder, image direction), `offBrandColours` (the colour check), `BRAND_KINDS` +
  `holdBrandShapes` (page-art kinds `lalpaar matra kantha alpana bird bpanel ornament`, rationed per
  page by `placeOf`).
- **Runner (`publication-runner.ts`):** design uses the brand house, brand references (4 per option)
  and the brand image style; skips `recentBlock`; `optionsBlock` varies pairs/devices, not faces;
  `brandWorld` holds every section (register "Ochin · neel + holud", `pair`, `lead`, `bn`); `checkDesign`
  skips the 50-register test for brand worlds; the section redesign and planned pages are held too;
  the page writer gets `bilingualLine` and keeps `wordbox` / `bengali-line` furniture (`bilingualBlocks`).
- **Critic (`page-look.ts`):** shown the brand's spreads, judges brand fidelity; lessons scope to
  `world: <brand name>` so they gather across the brand's issues.
- **Shim:** `brandOf(issue)` reads the brand and its kit; `buildPage` evals the kit before tk.js
  (defines `G`, `ochinShape`); `cli-shim/bengali.mjs` shapes every Bengali string of the page with
  HarfBuzz (`cli-shim/assets/harfbuzzjs`, MIT) in the brand's fonts; tk.js `bn()` draws them as one
  outline node, `brandShape()` draws brand kinds through the kit. Under a brand the page gets: matra
  over the title, sindur kicker + the section's Bengali name, Bengali-digit folio + "Ochin · title",
  and the Bengali line and word box placed in free space (`bilingual()`). INSPECT counts the outlines
  as type for overlap. Verified live 2026-10-13 on a test page (render in session).
- **Skills:** `quire-editorial-design` 3.0, `quire-illustration` 2.0, `quire-magazine-page` 2.0 are
  brand-first; the Claude skills `mag-design` / `mag-taste` read the same brand folder.
- Unbranded works are unchanged: no brand, no hold.


### Authored spreads (a brand with `author/`)

A brand that ships `brands/<id>/author/` (lib.js, LIB.md, its defining issue's spread scripts in
`exemplars/`) is not built through page specs. `core/src/pipeline/spread-author.ts` designs each
opening (cover alone, pairs, back alone) the way that issue was made: the designer names archive
pictures (shim `commons.mjs`, Wikimedia Commons, free licences only, credits in
`_assets/sources.json`), then writes the spread's text blocks and its Affinity script, shown the copy,
LIB.md, three exemplar scripts and their renders. The shim shapes the blocks (`spread.mjs`: English
measured with HarfBuzz and set live, Bengali as outlines) and runs the script (`affinity.mjs`
`runSpread`, `POST /affinity/spread`). Code checks (`faultsOf`: ran, every word placed, no overrun,
collision, fold or margin breach, folios) and the critic's eye against the exemplar renders decide
whether it is revised (3 rounds); the best version stands and is saved under
`<issue>/spreads/sNN/`, so a rebuild replays it without a model. The build stage takes this path
(`buildAuthored`); the art stage is skipped. `POST /api/v1/publications/:id/spreads {only, rounds}`
runs it for chosen pages, `GET` shows where each spread stands. Model tags: `design-spread-N`,
`design-pictures-N`, `design-pick-N` (designer), `design-look` (critic).

## Looks: the aesthetic is the editor's choice, per issue

`core/pipeline/looks.ts` (`lookOf`, `listLooks`, `imageStyleOf`, `saveImageStyle`) ·
`publication-runner.ts` (`setIssueLook`, `pageSetting`, `designOne`, `artPage {from}`) ·
`page-look.ts` (`referencePages`, `lookPrompt`) · `composition.ts` (`PageSetting.extras/layers`) ·
`page-plan.ts` (`layerShapes`) · skill `quire-editorial-design` §16 · routes
`PUT /publications/:id/look`, `GET /looks`, `GET|PUT /taste/image-style` · chat tool
`publication_look`.

- **Why.** One look (minimal editorial), asked for on Rain, had become every issue's law in five
  places: skill §16 ("whatever language a work speaks"), the eye's prompt, the composition check
  (two extras at most), the planner's ranking (-4 an extra) and the reference pages (the newest
  set was shown to every issue). A colourful Birds design was marked down for its coloured
  panels and cut-out birds, and pictures and drawn colour were never used together.
- **A look** is a folder of reference pages, `_taste/references/<look>/` in the shared Output,
  with `STANDARD.md` (what its best pages share, in the editor's words) and `look.json`
  (`extras`: most of pull/figure/panel a page carries, `layers`: pictures on drawn shapes). The
  issue keeps `look: {name, extras, layers}`. The design stage is told the look and its
  standard and shown only its pages; the eye judges by them; `checkComposition` limits extras
  only to the look's number; the planner counts an extra +4 in a layered look, -4 under a
  limit, 0 with none. **No look chosen imposes none**: no references, no standard, no limit.
- **The layered layer** (`layerShapes`, roles only, never colours): a picture stands on a shape
  that echoes its frame (an arch in a tall frame, a broad band under the subject in a wide
  one, colour `second`), the deck on a block of `third` clear of title and body, an `accent`
  band at the foot unless running text reaches it. The shim counts back shapes as grounds
  (`affinity.mjs`), so type on them takes ink or paper by contrast. An installed plan keeps its
  own `shapes`, through `holdShapes`.
- **The image style** the editor chose is `_taste/image-style.json`; every world's
  `imagePrompt` and `spec.imageDirection` are set to it after the design returns, and the design
  prompt designs around it. It changes only through `PUT /taste/image-style`.
- **Existing pictures.** `artPage {from}` (and `publication_art from`) copies a picture already
  made into the page's art, keeps it as the original in `.raw/`, and runs only its treatment
  through the shim's `/image/post`; the recipe records `reused`.
- **The cutout** (`postprocess.mjs`) fits the ground as a quadratic surface to the picture's
  border on a 3 px blurred copy (twice, dropping where the subject touches the edge), keys what
  sits as close to it as the ground does to itself, walks the edge back on the sharp pixels,
  drops specks and closes bites narrower than 1.2 % of the picture. It keys grainy and vignetted
  grounds and keeps an ivory casque on cream. No segmentation model is installed (Comfy's
  `background_removal` folder is empty).
- **Installing the same plan again** replaces its option (matched by label) instead of adding one.

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
  the real one (a book, an issue) that wins — `hooks/use-titles.ts` is that
  lookup for any screen (Audit, Gallery, Taste, Chat's rail) — otherwise a gate is raised
  against a slug read back as prose.
- "Back to work" — one tile per creation of **any** kind. Books and issues keep
  their own rows because they carry a real title and progress in chapters and
  pages; everything else comes from the folder walk. Each is a `WorkTile`, the
  same lettered cover the shelves draw, its glow tinted by the kind.
- the "In this folder" panel beside the machine.

**One ranking for every badge.** `lib/standing.ts` → `standingOf(counts,
stoppedAtGate)` is the order Home's gates use — blocked → stopped at a gate /
ready to sign → needs a read → signed off, `drafting` only while there is
nothing to read — and the Books and Magazines shelves and Home's "Back to
work" tiles all call it. Before, the shelf ranked on its own and called three
issues Home listed as waiting "drafting, none waiting". The shelves also read
`GET /productions/waiting`, so a run stopped at a gate counts there too.
`components/ui/work-tile.tsx` is the one tile all three draw.

Audit can be opened on a work: `#/audit/<kind>/<id>` (route `{page: "audit",
kind, id}`, `nav.toAudit(kind, id)`). Shelf tiles for folder-only kinds and
every folder gate on Home open it that way; without it the screen opened on
whatever it last had.

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
account of a stage in flight. Its start, finish and failure lines, and every
pipeline logger line, are also appended to `<workspace>/.quire/quire.log`
(set aside once at start past 4 MB), which is what the Logs screen reads —
the screen used to read a `quire.log` nothing wrote. `GET /api/v1/jobs` lists it and every change is
announced over SSE as `job:queued|started|progress|done|failed|cancelled`.

The screens read it through `hooks/use-jobs.ts`, held in `App.tsx` **above the
router** so a job outlives the page that started it. It seeds from `GET /jobs`
(the stream starts empty on every load, so a reload mid-stage would otherwise
show nothing) and follows the stream from there. The rail card and the run
screen both render from that one list, and `POST /jobs/:id/cancel` is reachable
from either.

**One status for every kind** (`studio/src/api/work.ts`). `GET /api/v1/work/:kind/:id`
answers title, kind label, stages, gates and the live job for any work — a
magazine through `publicationWorkflow`, a book through `bookWorkflow`, the
other kinds through `readAuditProject`. `GET /api/v1/now` lists every live job
with that status (`live`) plus jobs that ended in the last 6 hours (`recent`).
`hooks/use-live-runs.ts` reads it once in `App.tsx`; the same list feeds the
rail card, the topbar **Now pill** and its drawer (`components/shell/NowDrawer.tsx`,
on every screen, floating on chat which has no topbar), and chat's in-thread
cards (`components/chat/ChatWorkCards.tsx`: a live card per run, an end card
when a run this chat saw ends, the waiting count). `/publications/live` remains
for older callers.

**Audit is the workspace** (`#/audit[/<kind>/<id>]`, `pages/AuditPage.tsx`), its
own rail entry. Across the top, `WorkStrip`: the work, every count about it
(read, signed, open, blocking, reads, rewrites, de-AI, notes, voice) and its
stages - from the live run in `/now` while one is going, else from the audit
detail's workflow. Below, three equal columns (`useColumns("audit-workspace")`):
every work grouped by kind with its counts from `/workspace/summary` and its
pages under it | the .md reader/editor | this page's counts, findings, sign-off,
rewrite, verdict, pictures, then the gates and the run (foldable) and the world
card. Any work opens here: the rail, chat cards, crumbs and `#/work/<kind>/<id>`
(an older link) all route to it.

**The Library is the bookshelf** (`#/library[/<kind>]`, `pages/ProductionsPage.tsx`).
One shelf per kind. A work whose stages are all done (`GET /work/:kind/:id`)
stands with its cover - its chosen picture, else a lettered cover; anything else
shows its stage, progress and counts. Every work opens in Audit; a finished one
is meant to open its finished reader, which is not built yet. `#/books` and
`#/magazines` parse to it. A magazine's Brief/Sections/Pages/Proofs/Build stay on
`#/publication/<id>` and a book's chapters and export on `#/book/<id>/settings`,
linked from the strip.

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

Page writes, page audits and page revises (`page-N`, `audit-N`, `revise-N`
tags) take the same plain path (2026-10-06): the page and its research are
already in the prompt. Through the session, Indigo p8 hit agy's nine-minute
print timeout twice (the same prompt as a plain call answered in four), and a
timed-out `revise-13` ended a 2.4 hour audit with nothing saved. Plan, web,
design and research still run as sessions. A failed revise still fails the
whole audit stage; the pages it already rewrote are kept.

The magazine audit (`runAudit`) saves as it reads (2026-10-06). After each page
the model reads, `issue.audit` is written with `complete: false` and
`reviewed[n] = {hash, findings}`; the strip shows `partial` with "7/16 pages
read", and the copy gate says "the audit has not finished" instead of
"has not been audited". A resume or a re-audit reads only pages whose text hash
changed, so a revise re-reads only the pages it rewrote. A page the model
could not read is not remembered and is tried again. Before this the audit
lived in memory: a run stopped after 16 minutes, or a failed revise after 2.4
hours, left no page with any audit status. A plate page (empty body, written)
reads "picture only" on the Pages tab, not "not written".

The Audit screen reads its own stores (`.quire/findings.json`,
`.quire/audit-state.json`, keyed by page .md path), which the magazine run
never wrote, so a run with 65 findings showed every page "never read".
`syncPublicationAudits` (studio `api/audit.ts`) copies each page in
`issue.audit.reviewed` into them on `GET /api/v1/findings` and
`GET /api/v1/audit/project/publication/:id`: findings located against the
page .md, merged with `recordRun` (settled stays settled), `checked` set to
the audit's `at` so an unchanged audit is skipped. Issue-wide findings (page 0)
stay on the issue only. A finding with no quote lists but cannot highlight.

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
- `motion.css` is the whole motion language and the placement of the working
  states. Reduced motion ends every animation where it was going.
- `index.css` only wires things together: fonts, Tailwind, and Tailwind's
  theme pointed at the tokens (`text-cap`, `text-body`, `rounded-xl` = card,
  `max-w-measure`, one easing). It cannot be deleted: it is Tailwind's entry.

Both system files are imported into the `components` layer, so a Tailwind
utility on an element beats the component class beside it, which used to be
the job of inline `style={{}}`. Pages use component classes plus layout
utilities. The working states and progress are React components in
`components/ui/working.tsx` (`Working`, `Orb`, `Spinner`, `Ring`, `Bar`).
The working shapes are thought-orbs from the `thinking-orbs` package (MIT,
canvas, no dependencies): `Orb` maps searching → searching, planning →
shaping, thinking → composing, checking → solving, connecting → connecting,
building → weaving, generating → working, a gate waiting on you →
breathing; `orbForStage()` picks one from a pipeline stage id or label.
Writing stays a caret. `Ring` with `orb` draws the orb inside the progress
ring (rail run card, Run page). `Spinner` is the working orb. An orb reads its
tint from `--vermilion` (or `--ok`, or none for `tone="quiet"`) off its own
element, draws light ink inside `.on-char`/`.dark`, and pauses while off
screen or while the window is hidden; the package stops itself under reduced
motion.

`src/__tests__/ui-guard.test.ts` holds pages and components to zero literal
inline styles, zero `[12px]` sizes, zero hex colours and zero Tailwind palette
colours. The style guide (`#/styleguide`) renders all of it.

Don't name a component class after a Tailwind utility: utilities win the
cascade. The progress ring is `.arc` for that reason, since `ring` is Tailwind's.

Names on screen are what a person says, never what the disk or the API calls
them. Three helpers own that, and a screen showing a slug or a raw id is a bug:

- `lib/title-of.ts` — a creation's folder slug as its title
  (`the-lamp-room` → "The Lamp Room"); the slug stays in the tooltip.
- `lib/model-name.ts` — a model as "Gemini 3.8 Flash High · Antigravity"
  rather than `antigravityCli · antigravity/gemini-3.8-flash-high` (top bar,
  Chat, Settings → Agents); the raw pair stays in the tooltip.
- `lib/manuscript-md.ts` — the Audit reader draws a manuscript's markdown
  (headings, quotes, rules, emphasis, and the pipeline's `*visual brief*`
  notes as quiet notes) by hiding the syntax as runs. The text is never
  rewritten, so finding offsets still point into the raw file and paragraph
  numbers still match the reader map. Edit mode shows the raw markdown.

More helpers that own a sentence on screen:

- `lib/when.ts` — every date: relative inside a day, "16 Sep" this year, the
  year only when it differs; `whenExact` adds "15:53". No screen formats a date
  with the locale any more ("9/16/2026" beside "11 hours ago").
- `lib/error-copy.ts` → `plainError`, and `briefly(detail)` for a one-line
  status (the stage strips) that may be carrying a provider's raw error.
- `components/ui/page-head.tsx` — the one page header: a sentence title, a
  lede, actions on the right. Every screen uses it except Start, which keeps
  its front-door hero.

Colour rules the sweep of October 2026 settled:

- Vermilion is for what needs you (an action, a blocker, a count that asks).
  A state — the chosen segment, a pressed filter, the selected row — is ink or
  `--select`, never the accent. Approved counts are `--ok`.
- `--work*` tokens are the ground the work is read and talked on: charcoal in
  the dark theme, paper in the light one. The chat conversation, the Audit
  reader and the fullscreen editor re-point their `--char*` tokens at them, so
  a light window no longer has a black slab in the middle.
- A disabled filled button goes neutral, not 40% accent.

Spacing rules (the second sweep, October 2026):

- `--inset` (20px, 16px inside `.cols-audit`) is the one side inset for
  `.panel`, `.panel-head`, `.panel-body`, `.empty` and `.desk-card`. Pages do
  not override a panel's side padding with utilities; a narrow workbench
  lowers the token instead.
- `.row` has no side padding, so a row's name starts on the same edge as the
  panel heading above it. The current row's ground is a `::before` reaching 8px
  past the row (the bar sits at its left edge), so selecting a row never moves
  its text. The chat switcher (`.grp-switch`) uses the same ground and bar; its
  old in-flow disc is gone.
- A mark in place of a number (`TypeMark` in the Audit list) sits in
  `.mark-slot`, the width of `.row .num`, so every name in a list lines up.
- `.tabs` space tabs with the strip's gap, not tab padding: the first tab
  starts on the page edge and the underline is the word's width.
- Page sections are `.stack-lg` (26px); grids of panels, tiles and desk cards
  use 16px gaps.
- A form field's label is one style (`.field > label`, `.field > .label`,
  `.field-label`): sentence case, caption size. Tracked capitals are for
  section eyebrows outside fields.
- `.stats` is a five-column grid so a second row of figures shares the first
  row's columns. The Audit status block's stage list drops its side rule and
  indent by a container query on the row itself, not the window.
- The Audit reader head names the place ("Page 1") instead of the title when
  the page opens on its own heading, and its tools sit in `.readtools`: text
  tools in one group, the page's state in another that stays on the right
  when it wraps.

Motion (`motion.css`): a screen's sections settle top to bottom (keyed on the
page in `Shell`, `.route-enter`), lists/tiles/chips arrive in 30ms steps
(`.stagger`, `.tiles`), folds and menus grow from where they were opened, the
segmented control's thumb slides (`Seg` measures the pressed button), covers
glow on hover, live states breathe. All under 250ms, all off under
`prefers-reduced-motion`.

The disc ornaments (`.disc`, the geometry layer) appear only on the Start page
and the style guide. Scattered across every panel, each one slightly
different, they read as decoration rather than identity.

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

## The audit runs only when asked

A run stops where it is told (`stopAt`, default `write`): the audit is never added on after writing.
It runs from the issue's Audit button (`POST /api/v1/publications/:id/audit`) or a run told
`stopAt: "audit"`. (2026-08-26 to 2026-10-13 the runner forced it after every write; removed.)
An issue whose every page is in reads `written`, not `writing`.

## Driving Quire from an agent over MCP

`desktop/quire-mcp.mjs` is an MCP server over the whole HTTP API: `quire_api {stage, method, path,
body}`, `quire_status`, `quire_up`, `quire_down`. Registered in Claude Code with
`claude mcp add -s user quire -- node <path>`. (`cli-shim/mcp-server.mjs` is the other direction:
tools Quire hands its own model CLIs.)


## Delete, pick up, and the launch diary (0.1.31)

- **Delete any work**: `DELETE /api/v1/work/:kind/:id` (`studio/src/api/work.ts`). Refused while a job
  is on it. The work's folders (`<outDir>/<id>`, and for a magazine `<outDir>/issues/<id>`) move to
  `<workspace>/.quire/trash/<stamp>-<kind>-<id>/`, out of every listing; put back by moving them home.
  Buttons: the Audit screen's right column ("Delete this …") and the magazine page header.
- **A run that died with the app** writes no `lastError`, so it had no continue button.
  `publicationWorkflow` now reports a half-done stage (`partial`, or an `-ing` status) with nothing
  running as a stopped run at that stage (`cutShort`), so the "Pick up from …" card shows on the
  magazine page and the Audit screen, and the Library card says where it stopped.
- **Launch diary**: every launch appends `secs, build, what, exe` to `~/.quire/launches.log`
  (`~/.quire-dev/` for dev), including "second launch handed to this running copy" from the
  single-instance hand-off. Kept to catch prod reopening on a lower version after an update.
