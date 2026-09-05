# 14 — Pipeline Fix: Implementation Spec

> Agent-implementable plan. Work happens in `Quire-Dev` on branch `dev` (per
> CLAUDE.md). **Edit the engine at SOURCE**: `Quire-Dev/vendor/studio/packages/core/src`
> (pipeline/ has 23 .ts files incl. runner.ts, scheduler.ts, detection-runner.ts,
> publication-*.ts; productions/registry.ts; publications/ with builtin
> `packages/core/publications/magazine.json`). `desktop/vendor-studio.mjs` stages the
> build into `cli-shim/engine`. Shim code in `cli-shim/`. Test surface: HTTP API —
> dev shim :8788, dev Studio :4568 (`node desktop/quire-ctl.mjs dev …`).

## The invariant (what the user defined)

Every applicable production type runs the SAME macro-pipeline:

```
CONTENT  →  gate:content  →  DESIGN (images)  →  gate:design  →  BUILD (Affinity)  →  gate:build
```

Only the *implementations inside* each macro-stage differ per type. The workflow —
stage order, gates, hand-offs, events, resume — is identical and owned by ONE
orchestrator. Today none of this hand-off exists: stages are disconnected endpoints.

## 1. Data model

### 1.1 Stage graph in the production registry

File: `quire-core/dist/productions/registry.js` (and its source). Extend each entry:

```js
{
  id: "book", outDir: "books", …existing…,
  pipeline: {
    content: ["plan", "write", "audit", "destyle"],      // sub-stages, in order
    design:  ["artplan", "generate", "review"],          // [] if images:false
    build:   ["layout", "export"],                       // [] if no build target
    gates:   ["content", "design", "build"],             // which gates exist
    buildTarget: "print-pdf|epub|screenplay-pdf|panel-sheet|none"
  }
}
```

Per-type values:

| Type | content | design | build | gates |
|---|---|---|---|---|
| book | plan,write,audit,destyle | artplan,generate,review (cover + optional plates) | layout,export (epub + print-pdf) | c,d,b |
| short | write,audit,destyle | artplan,generate,review | layout,export (mini-zine pdf) | c,d,b |
| publication (magazine) | research,plan,write,factcheck,audit,destyle | artplan,generate,review (per page) | layout,export (affinity pdf) | c,d,b |
| storybook (new def) | plan,write,audit | artplan,generate,review (per spread) | layout,export (affinity pdf) | c,d,b |
| storyboard | plan,write,audit | artplan,generate,review (panels) | layout,export (panel-sheet) | c,d,b |
| script | plan,write,audit,destyle | — | layout,export (screenplay pdf) | c,b |
| translation | write,audit,destyle | — | export (epub) | c,b |
| interactive-film | plan,write,audit | artplan,generate,review | — (html runtime) | c,d |
| play | — (live) | — | — | — |

**Verified facts this table must fix (code dig 2026-09-01):**
- Today books/short/script/translation have **NO export step at all** — the run ends
  at markdown on disk. Book/short art = cover only (`generateCover`/`coverImagePath`);
  the full design macro-stage for them is NEW work, not re-wiring.
- Registry flags `ProductionSpec.images` and `.factCheck` are **declared and read by
  nothing** (only `auditable`/`label`/`outDir` are consumed) — and `play` says
  `images:false` while `play-image.ts` exists. When adding `pipeline`, make the
  orchestrator the single consumer of these flags and fix the lies, or delete them.
- `DesignSpec` (publication-design.ts) is **already generic by design** ("a cookbook,
  a report and a magazine all need to know what colour the page is") — palette + type
  + grid + imageDirection + pages; only `pages` is magazine-shaped, and
  `designReferences()` (project mood board from `<project>/design-references/*.md`)
  is generic too but has one caller. The design macro-stage for every type reuses
  THIS spec + reader — do not invent a second design-spec format.

### 1.1b Build shapes (one gate flow, three renderers)

Same gates for everyone; `buildTarget` resolves to one of three build SHAPES:

| Shape | Types | Renderer |
|---|---|---|
| **page-shaped** | magazine, storyboard, storybook | existing Affinity flatplan build (places fixed pages) — nearly fits today |
| **reflow-shaped** | book, short, translation | a DIFFERENT Affinity script (text autoflow across master pages, TOC, running heads, widow control) — new `affinity-reflow` executor; Typst fallback for no-Affinity machines. Plus existing epub export |
| **not-paper** | interactive-film, play | no PDF; the design spec still drives the exported HTML (palette/type) |
| (special) | script | industry format (Final Draft / Fountain → PDF), NOT art-directed — build without design gate stays correct |

### 1.2 Run state file (single source of truth per production)

New file per production: `<outDir>/<id>/pipeline.json`

```json
{
  "version": 1,
  "type": "book",
  "stage": "design.generate",          // "<macro>.<sub>" | "gate:content" | "done"
  "status": "running|waiting-gate|failed|idle|done",
  "units": {                            // per-unit progress (chapter/page/spread)
    "kind": "chapter",
    "total": 12, "done": 7,
    "failed": [{ "unit": 5, "error": "...", "resumable": true }]
  },
  "gates": {
    "content": { "state": "approved", "at": "...", "by": "user", "perUnit": {"1":"approved", …} },
    "design":  { "state": "waiting" },
    "build":   { "state": "blocked" }
  },
  "history": [{ "at": "...", "event": "stage:done", "stage": "content.audit" }]
}
```

### 1.2b The "database" question (state handling today → target)

Today there is NO database: state is JSON + markdown on disk (`book.json`,
`chapters/index.json`, `story/state/*.json`, `publication.json`), each runner
mutating its own files piecemeal. Keep files as the source of truth (portable,
git-able, user-ownable — a real strength), but fix the three actual problems:
1. **Atomicity** — all multi-file mutations go through `commitProductionArtifacts`
   (20 §H1) so a crash never half-writes state.
2. **Query speed / cross-production views** — add a rebuildable **SQLite index**
   (`<workspace>/.quire/index.db`) over pipeline.json + sidecars + findings; it is a
   CACHE, deletable anytime, rebuilt by scanning files. Home/waiting/analytics/gallery
   query the index, never walk folders.
3. **Reversibility** — no state transition without an inverse (see `withdraw` below);
   history is append-only inside pipeline.json.

Rules:
- Written atomically (tmp + rename). Every stage transition appends to `history`.
- The magazine's existing `publication.json` gate fields become *derived from* this
  file (adapter reads pipeline.json; do not maintain two truths).

## 2. The orchestrator

New module: `quire-core/src/pipeline/orchestrator.ts` (compiled into dist).

### 2.1 Responsibilities

1. `advance(productionRef)` — the ONLY function that moves the pipeline:
   - reads `pipeline.json`, finds current stage, checks completion,
   - if a stage's units are all done → mark stage done, enter next stage,
   - if next is a gate → set `status: waiting-gate`, emit `gate:open` event, STOP,
   - if next is a stage → enqueue its jobs and emit `stage:start`.
2. Gate approval handlers: `approve(gate, units?)`, `reject(gate, units, note)`.
   - Approval of the last pending unit calls `advance()` automatically. **This is the
     missing link the user described**: approving content now *causes* image
     generation; finished image generation *causes* the design gate to open.
   - Rejection re-enqueues only the rejected units into the responsible sub-stage
     (reject at design gate with `reason:"content"` → back to content.write for that
     unit, and content gate for that unit is withdrawn — reuse the existing
     approval-withdrawal logic proven in `publication-test.mjs`).
   - **`withdraw(gate, units?)` — approvals are NEVER one-way (fixes the current
     bug where a signed-off content cannot be reopened).** Withdrawal semantics:
     (a) gate state for those units → `waiting`, edit routes unlock;
     (b) counters/history are PRESERVED — `history` appends `gate:withdrawn`,
         nothing is decremented or erased;
     (c) downstream cascade: withdrawing content marks that unit's design/build
         artifacts `stale` (not deleted — sidecar lineage keeps them for reuse);
         re-approval re-opens design review only for stale units;
     (d) a running downstream job for that unit is cancelled via the queue.
     Rule of thumb: **the ONLY irreversible states are external side effects**
     (a published/exported file the user shipped); every internal state must have
     an inverse operation. Audit each existing one-way flag (`approved`,
     `designApproved`, chapter `published`, issue `build.pdf`) against this rule
     and add the inverse route where missing.
3. Crash/resume: on Studio boot, scan all `pipeline.json` with `status: running`,
   mark interrupted jobs `failed(resumable)`, surface in UI; `resume()` re-enqueues.

### 2.2 Stage executors (adapter table, not new engines)

`orchestrator` never implements stages; it dispatches to existing modules:

| Stage id | Existing implementation to wrap |
|---|---|
| content.research | `publication-research.js` |
| content.plan | architect / `persisted-governed-plan.js` / publication plan |
| content.write | writer / `publication-runner.writePage` / short runner |
| content.factcheck | `fact-check.js` |
| content.audit | `story-audit.js` / `publication-audit.js` |
| content.destyle | `detection-runner.js` + `quire-story-deslop` skill (see §5, file 17) |
| design.artplan | NEW (small): derive image briefs from approved content + world (08) |
| design.generate | shim `POST /comfy/generate` per brief, writes sidecar (04) |
| design.review | no-op executor; exists so the gate has per-unit candidates attached |
| build.layout | shim `POST /affinity/page` per page / template layout |
| build.export | shim `POST /affinity/build` / epub exporter / Typst |

Executor contract: `run(unit, ctx) -> { ok, artifacts[], error? }` — pure, no
knowledge of what comes next. All sequencing lives in the orchestrator.

### 2.3 Job queue

New: `quire-core/src/pipeline/queue.ts`. Table persisted at
`<workspace>/.quire/jobs.json` (sqlite later if needed).

```
job: { id, productionRef, stage, unit, state: queued|running|done|failed|cancelled,
       progress: 0-100, log: [last 50 lines], artifact?, startedAt, endedAt }
```

- Concurrency limits per resource class: `llm: 1` (CLIs are serial anyway),
  `comfy: 1`, `affinity: 1` — declared per executor.
- `cancel(jobId)` kills the child process (Comfy: interrupt via `/interrupt`;
  Affinity: close session; CLI: kill spawn).
- Every state change emits an event (§3).

## 3. Events (the connective tissue the UI needs)

### 3.1 Shim event bus

Add `GET /events` (SSE) to `cli-shim/server.mjs`. Emit:
`comfy:install:progress {pct,file}`, `comfy:generate:{start,progress,done,fail}`,
`affinity:{open,page:done,build:progress,build:done,fail}`, `cli:detected`,
`mcp:server:{up,down}`.
Implementation: tiny `events.mjs` with `subscribe(res)` / `emit(type, data)`;
wire emits into `comfy.mjs` (poll loop already exists — emit per poll),
`comfy-install.mjs` (download loop), `affinity.mjs` (per page/script).

### 3.2 Studio event extension

Studio already has `/api/v1/events`, and the frontend consumes it through an
**allowlist** in `packages/studio/src/hooks/use-sse.ts` (book:creating, write:complete,
daemon:*, agent:*, audit:*, publication:*, llm:progress, log, …). New event names MUST
be added to that allowlist or the UI silently drops them. Add event kinds:
`pipeline:stage {ref, stage, status}`, `pipeline:gate {ref, gate, pendingUnits}`,
`job:{queued,progress,done,failed} {job}`.
Studio server proxies shim `/events` into its own stream (one connection for the UI).

### 3.3 UI contract

The "waiting on you" panel (02) is just: all productions where
`status == waiting-gate`, listing `gate` + pending units. The run view subscribes to
`job:*` for live progress. No polling anywhere.

## 4. API surface (Studio, new/changed routes)

```
GET  /api/v1/productions                       → list all types, pipeline state summary
GET  /api/v1/productions/:type/:id/pipeline    → pipeline.json
POST /api/v1/productions/:type/:id/advance     → force-advance (admin/debug)
POST /api/v1/productions/:type/:id/gates/:gate/approve   { units?: [] }
POST /api/v1/productions/:type/:id/gates/:gate/reject    { units, note, backTo? }
POST /api/v1/productions/:type/:id/stages/:stage/rerun   { units }
GET  /api/v1/jobs                              → queue list
POST /api/v1/jobs/:id/cancel
POST /api/v1/productions/:type/:id/resume
```

Existing book/publication routes keep working; internally they delegate to the
orchestrator (e.g. `POST /books/:id/chapters/:n/approve` → `approve("content",[n])`).

## 5. Per-type content correctness (user's 1.1)

- **Books**: wire `destyle` after audit (executor = detection-runner score; if score >
  threshold, run reviser with the deslop skill prompt; loop max 2). Currently the
  score is computed and ignored — that's the bug to close.
- **Shorts/scripts/storyboards/translation**: these runners never call audit/destyle
  uniformly. Route them through the same executors via the stage graph (they're
  `auditable: true` in the registry already — the wiring is what's missing).
- **Magazine**: already has research→factcheck; add destyle; keep page-bundle
  authoring plan (13) as the `content.write` executor evolution.
- **Style packs (05)** slot into `content.write`/`destyle` executors as prompt
  fragments — no orchestrator change needed later.

## 6. design.artplan (the new small executor, per type)

Input: approved content units + world spec (08) + type config. Output: per unit,
`art/briefs/<unit>-<slot>.json` `{ slot, subject, composition, cutout?, prompt,
negative, size, workflow, stylePack }`.
- book: 1 cover brief (+ optional chapter plates if enabled)
- storybook: 1 brief per spread, includes character ref (recurring cast)
- magazine: briefs come from page spec (13); executor just materializes them
- storyboard: 1 per panel from beat text
LLM call: one turn per unit using the type's prompt template (definition-style, like
`publications/*.json` prompts — add `prompts.artplan`).

## 7. Implementation order (each step shippable + testable)

| # | Task | Test (over HTTP, quire-ctl) |
|---|---|---|
| 1 | `pipeline.json` schema + read/write lib + migration for existing books/issues | unit test: create/advance/atomic write |
| 2 | Registry `pipeline` field for all types | `GET /productions` shows stage graphs |
| 3 | Orchestrator `advance` + gates, book type only, content macro only | approve last chapter → status flips to waiting-gate:content→design |
| 4 | Job queue + shim `/events` + Studio event proxy | SSE shows job progress for a comfy generate |
| 5 | design.artplan + design.generate executors (book cover) | approve content → cover brief → image + sidecar → gate:design opens **unprompted** |
| 6 | build executors wired (epub for book; affinity for magazine) | approve design → build starts → gate:build opens with PDF path |
| 7 | Reject-with-backTo (withdrawal semantics) | reject design unit citing content → unit back in write, content gate reopened |
| 8 | Roll out stage graph to short/script/storyboard/translation | each type walks its declared graph end-to-end |
| 9 | Resume + cancel | kill Studio mid-write → boot → resumable job listed → resume completes |
| 10 | Storybook definition (12) on the now-uniform rails | new type works with zero orchestrator changes |

Acceptance (the user's exact complaint, closed): *clicking approve on the last
content unit starts image generation with no further clicks; when the last image
lands, the app asks for design approval; approving that starts the Affinity build;
the whole run is visible live and survives a restart.*
