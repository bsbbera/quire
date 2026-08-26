# Quire — Integration Plan

One harness. Every model a provider. Every capability a tool. Every publication type the same loop.

Status of this doc: plan only. Nothing below is built unless marked DONE.

---

## The thesis

InkOS today runs its generation pipeline with `tools: []` (`packages/core/src/agent/worker-agent.ts:258` — upstream code, unmodified by us). Tools live only in the interactive chat path (`agent-session.ts`).

Quire's publication pipeline (`pipeline/publication-runner.ts`, `agents/publication.ts` — both added by us) copied that constraint onto a medium that needed the opposite. That was a design mistake, not an inherited limitation.

The target:

```
request (any type)
    │
    ├─ harness turn ──── model proposes tool call
    │                       host executes, host gates, host persists
    │                       result returns to model, model continues
    │
    ├─ checks run as pipeline defaults (37-dim audit, de-AI-ification, revise)
    │
    ├─ user approves content + design
    │
    ├─ production tools fire (ComfyUI, Affinity) ── feedback loop ──┐
    │       "recreate entire magazine"  → full teardown + rebuild   │
    │       "change design p16/sec1"    → that element only         │
    │                                                               │
    └─ artifact ◄──────────────────────────────────────────────────┘
```

Publication type is not special. A magazine is a story type that can also build a magazine. Story, script, storyboard, magazine — one loop, different capabilities.

---

## Phase 1 — CLI models become ordinary providers — **DONE**

**What was actually wrong.** The plan said two tool channels. There were three, and
the host owned one:

| # | Channel | Who executed | Gated |
|---|---|---|---|
| 1 | `body.tools` → `toolProtocol()` → fenced block → `tool_calls` | InkOS host | yes |
| 2 | MCP servers at launch (`--mcp-config`, `-c mcp_servers.*`, ACP `session/new`) | CLI's own loop | no |
| 3 | `toolNote()` — "run `node mcp-server.mjs <tool>` as a command" | CLI shells out | no |

`server.mjs` said it outright: *"by the time we see a tool event the work is already
done."* Channels 2 and 3 are how `quire_affinity_build` was reachable without the
approval and spec checks the runner enforces. Making `createExternalMcpTools()`
unconditional as originally planned would have added a **fourth** channel and left both
bypasses standing.

**What was built.** Collapsed to channel 1.

- `cli-shim/harness.mjs` — new. Single authority for how a CLI turn is assembled and how
  calls come back. `launchServers()` returns nothing, in one place, so there is one
  answer to "can the CLI run something we did not authorise".
  `QUIRE_CLI_OWN_TOOLS=1` restores the old behaviour for debugging; not supported.
- Channel 3 (`toolNote()`) deleted.
- Channel 2 emptied. `claude` additionally gets `--strict-mcp-config` so its own
  configured servers stay out. **`codex` has no equivalent** — its `config.toml` servers
  still load and Quire cannot stop them. Noted in the adapter, not papered over.
- `isCliBackedModel` deleted from `agent-session.ts`. `createExternalMcpTools()` now
  unconditional — the host reaches MCP, and offers it to every model through channel 1.
- An empty tool table is now declared to the model rather than left silent, so it says
  it cannot do the work instead of describing work it did not perform.

**Verified live, devin-backed** — repeatable, `node cli-shim/harness-live.mjs devin`:

1. Tool call returns through the host as OpenAI `tool_calls`, `finish_reason:
   "tool_calls"`. ✅
2. Tool result feeds the next turn; model issues a *different* call using the returned
   path. ✅
3. Same prompt with an empty table → "I have no tools available this turn", no shell-out.
   Bypass closed. ✅
4. Streaming: no fence leaks into text deltas, call arrives as a `tool_calls` delta. ✅
5. Regression: 92 core tests (agent-tools, agent-tools-params, publication-audit,
   publication-intake) + 49 agent-session tests pass; core typecheck clean.

**Known gaps carried forward.**

- `codex` config.toml servers remain outside the gate (above).
- Serializing a large MCP tool table into the prompt has an unmeasured token cost.
  Measure when the table grows.
- **`claude` is untested against the live harness on this machine.** Not a harness
  defect and not environment pollution (an earlier note here said pollution; that was
  wrong). `~/.claude/settings.json` carries an env block pointing the CLI at Ollama —
  `ANTHROPIC_BASE_URL=http://localhost:11434` — and nothing is listening there, so every
  `claude` run returns ConnectionRefused. `claude` runs through Quire will fail the same
  way until Ollama is running or that block is removed. `devin` passes all four checks.
- A CLI reading its own settings file can redirect itself somewhere the shim cannot see.
  Worth surfacing in the app as a provider health check rather than as a failed run.

---

## Phase 2 — Publication types run on the harness path — **DONE**

**Both UNVERIFIED items resolved before writing any code:**

- `bookId: null` is supported. Exactly one throw exists (`agent-session.ts:942`) and it
  is for `interactive-film-authoring` only. Publications pass null.
- `PipelineConfig` requires only `client`, `model`, `projectRoot`. Not chapter-bound.

**Built.**

- `pipeline/publication-session.ts` — new. `createPublicationAsk()` returns an `AskFn`
  backed by `runAgentSession`, so every stage carries a tool table and the host keeps
  its confirmation and persistence around each call.
- `PublicationAgent` deleted. Nothing referenced it.
- `"publication"` added to `SessionKindSchema`, with its own tool set (research, image,
  project read, material retrieval) and its own system prompt. It previously fell
  through to the **chat** prompt — which tells a session it may propose actions and
  start books, so a stage would answer the user instead of producing the stage's JSON.
- `workerModel` exported from `worker-agent.ts`, so a stage uses the client the run was
  configured with rather than re-resolving the id through the provider registry and
  possibly landing on a different endpoint.
- `publication_create` wired to the new ask, with the issue id resolved lazily — the
  issue is created *from* the context that carries it.

**Deliberately not changed:** one session per stage, keyed by issue and tag. A page is
still written from its prompt, not from a growing transcript. Memory across pages is
Phase 7.2; folding it in here would make a context-growth bug look like a tools bug.

**Tests:** 10 new (`publication-session.test.ts`), 151 passing across the touched
suites, core typecheck clean.

**Also fixed:** `agent-session.test.ts` ran real MCP discovery against the shim, so its
tool-table assertions passed with Quire closed and failed with it open — latent before,
exposed once every model started reaching MCP. Now mocked.

---

## Phase 3 — Production capabilities become tools

**Why.** Today `artPage()` POSTs `/comfy/generate` and `build()` POSTs `/affinity/build` at fixed positions in a script. The model cannot reach them, cannot see a render, cannot redo one page. A script stopped at `write` is dead.

**Steps.**

1. `comfy_generate` — prompt + page/element ref → image path. Callable at any point.
2. `affinity_place` / `affinity_build` — gates enforced inside the tool body.
3. `affinity_render` — render a spread, return the image into the model's context. Without this the model designs blind. This is what makes design iterative rather than one-shot.
4. Delete the hardcoded HTTP calls from `publication-runner.ts` once tools cover them.
5. **Scoped mutation.** Every generated element carries a stable address (`page:16/section:1`). Tools accept that address. Three verbs:
   - `recreate` at issue scope → teardown + full rebuild from current content + design
   - `update` at element scope → regenerate that element only, siblings untouched
   - `delete` at element scope
6. **Feedback loop.** Post-build, user feedback re-enters as a harness turn. The model resolves the feedback to a scope and a verb, then calls the matching tool. "Recreate the entire magazine" → issue scope. "Change design on p16/sec1" → element scope. The model picks; the host enforces that the scope it claimed is the scope it gets.

**Done when.** Feedback on one section changes that section's files and nothing else, provably by diff.

---

## Phase 4 — Gates hold, MCP ships default — **DONE**

**Steps.**

1. Kill the bypass. `quire_affinity_build` (`cli-shim/mcp-server.mjs:96-118`) calls `affinity.build()` directly, skipping `requireApproval`, `requireDesignApproval`, `checkSpec` — the three gates `publication-runner.build()` enforces. Route it through the runner. Likely the path the shipped magazine took.
2. Gates enforce host-side, in the tool body, never by prompt. Model asks; host decides.
3. Approval needs a real surface (Phase 6). A gate with no UI is a deadlock.
4. **Affinity MCP ships with the app package.** Bundled, registered, enabled on first run — not something the user wires up. Visible in the MCP page as a default server.
5. MCP page lists bundled vs discovered servers distinctly, so a default that fails to start is obvious rather than silently absent.

**Done when.** A build attempted without design approval fails at the host — on both transports, from both the tool path and the MCP path.

---

## Phase 5 — The checks, as defaults — **DONE**

**What was actually wrong.** Three separate things, and only one of them was the
missing auditor:

| | |
|---|---|
| `stopAt` defaulted to `"write"` | Every run that took the default — which is every run — stopped one stage *before* the audit. The checks were reachable on paper and skipped in practice. |
| No model ever read a page | `publication-audit.ts` counts words and paragraph variance. Everything that only shows on reading (an unsourced number, a deck that promises what the body never delivers) went unchecked. |
| Findings went nowhere | An audit that found eighteen problems fixed none of them. Nobody was reading the reports. |

**What was built.**

- `pipeline/publication-review.ts` — new. 31 editorial dimensions, the audit prompt,
  the finding parser, and the revise prompt. Per page, not per issue: a forty-page
  issue in one prompt gets a model that skims, which is the failure mode that makes
  an audit look like it ran when it did not.
- `runAudit(ctx, id, {deep, revise, rounds, only})` — rules **and** model, then the
  findings are rewritten out and the pages audited again. Two rounds by default.
  Stops early when a round changes nothing.
- `revisePage(ctx, id, n, findings)` — bounded to the page, forbidden from adding a
  fact not already in the page or the research, and it clears the copy approval,
  because approval is of specific copy.
- `runDeslop` — the same loop with a slop filter, not a second implementation.
- `publication_audit` and `publication_deslop` — the tools. Both open their own
  context by issue id, so any existing issue is reachable.
- `run()` now promotes `stopAt: "write"` to `"audit"`. A run that wrote pages audits
  them.

**Honest count.** "37 dimensions" is 31 model-judged plus the 6 the rule pass already
owned. It is not the chapter pipeline's 37, and it should not be — those are story
dimensions. See DEBT.md D5.

**Verified.** 12 tests on the review module, 11 on the loop (revises, re-audits, stops
on the round budget, gives up when a rewrite changes nothing, clears approval, survives
a page the model cannot read, filters correctly for deslop). Core suite 1932/1934 — the
two failures are Windows symlink EPERM, unrelated.

**Not verified.** No real model has run this yet. DEBT.md D3.

---

## Phase 6 — Studio reachability — **DONE**

**What was actually wrong.** Two routes, both GET. No approve, resume, build or re-run
anywhere. That was not a missing convenience: `designApproved` had **no surface in the
app at all**, so every build gate added in Phase 4 was a gate nobody could open, and a
run stopped after `write` was finished for good.

**What was built.**

- `studio/src/api/publications.ts` — new module, kept out of server.ts because these
  routes need a pipeline and that dependency is passed in rather than reached for.
  `GET /:id`, `POST /:id/approve`, `/resume`, `/audit`, `/render`, `/feedback`.
- `stageStates()` and `gateState()` — derived from the issue file, never from the
  `status` string, which drifts the moment a tool changes something outside the run
  that set it. Every shut gate names what is keeping it shut.
- `pages/PublicationDetail.tsx` + `#/publication/:id` — stages, gate cards with
  approve/revoke, resume-from/through, the findings list, per-page bodies, spread
  render, and a per-page note box.
- Sidebar now lists what has been made, not only the types that could be made.

**One decision worth naming.** A note on a page is not a comment field. It becomes a
finding and goes through the same revise pass the audit uses — so feedback lands where
the checks land.

**Design approval is refusable.** Copy approval warns and lets the editor through;
design approval is blocked while `checkDesign` fails, because `build` reads the spec
and approving a broken one only moves the failure later.

**Verified.** 7 tests on the derived state. Route wiring and the page itself are
click-tested, not unit-tested — DEBT.md D4.

**Not built.** Section-scoped feedback (D8). Approval has no identity behind it (D9).

---

## Phase 7 — Memory and state parity — **DONE**

**What was wrong.** Four things, and only two of them were about memory.

Books have had memory since the beginning: `memory-retrieval.ts` picks the
summaries, hooks and facts a chapter needs and hands the writer a slice.
Publications had nothing, and the two places that needed recall were faking it
by truncation — the writer got 140 characters of every page already written,
the auditor got 200. At forty pages both are a wall of fragments, and the
research fallback was worse: "the first four findings of every pillar",
regardless of what the page was about.

The other two were durability. `publication.json` had no validation at all
while definitions had plenty, and by Phase 5 there were tools mutating an issue
from outside the run that created it. `save()` was a plain `writeFile`, so a
crash mid-write left half a JSON file where the issue used to be.

**What was built.**

- `publication-memory.ts` — an index per issue, over `LocalSearchIndex`, which
  is the same BM25 kernel book memory already retrieves through. Pages and
  research findings, rebuilt from `publication.json` on every query, so it is a
  projection and deleting it costs nothing.
- Recall wired into both places that were truncating. Above twelve written
  pages the writer and the auditor get the pages that bear on this one; below
  it the complete list is still better than any ranking of it.
- `publication-schema.ts` — checked on read and before every write.
- `save()` writes a sibling and renames over the target.
- One predicate for "written", replacing the two that disagreed on screen.

**Publications are another work unit, so they got what books have** — with one
deliberate exception. `MemoryDB`'s temporal layer tracks a fact's validity
across chapters because a character's state changes over a book. Page 13 does
not invalidate what page 12 established, so publications get the retrieval half
and not the temporal half. The part that transfers is the part underneath both.

**Verified.** Core 1948/1948, studio 590/590 — the first fully green run, after
closing the two Windows symlink failures and the pre-rebrand assertion that had
been hiding real failures in the noise. Both issues in the workspace load,
index, and open in the app; the detail page and the sidebar both read 16/16.
Recall against the film issue's timeline page returns the Brownie, the Polaroid
and Ektachrome, which is what that page is about.

**Found by running it against real data, not by testing it.** Three times the
first version was wrong about the user's own back catalogue:

- The schema required what `PublicationIssue` declares. A real issue, made
  before `type`, a section's `question` and a page's `premise` existed, would
  not load. Loosened, it failed again on `density: null` and furniture stored as
  bare strings. It now requires the spine and nothing else.
- The index read only the current research shape. Both real issues store the
  old one — `{origin: [{fact, who, when}]}`, no wrapper, no URLs — so indexing
  only the new shape would have given the only real data no research at all.
- `openIssueContext` refused any issue with no `type`, which is a 500 on the
  detail page. One of the two issues in the workspace had never opened. The
  definition whose directory holds the file is the answer, and `findIssue`
  already knew it.

**Not verified.** No page has been *written* or *audited* with recalled context
in the prompt. Recall retrieves well; whether the pages come out better for it
is D17.

---

## Phase 8 — Final test

1. Full magazine, CLI-backed model, zero manual steps: create → research → write → audit → revise → art → design → approve → build → PDF.
2. Same run, approval denied at build — gate holds.
3. Same run, ComfyUI down — failure surfaces; no magazine ships with missing art.
4. Feedback: "change design on page 16 section 1" — that section changes, diff proves nothing else did.
5. Feedback: "recreate the entire magazine" — full teardown, rebuild from current content and design.
6. Same suite passes on a second publication type, proving the loop is generic.

---

## Order

```
1 ─→ 2 ─→ 3 ─→ 4 ─→ 5 ─→ 6 ─→ 7 ─→ 8
        done ───────────────┘
```

Phases 4 and 5 swapped: the build-gate bypass turned out to be real and evidenced (the
shipped issue has `approved` but no `designApproved` key at all), so it was closed
before building on top of it. Phase 6 moved ahead of 7 because Phase 4 left gates that
nothing could open.

Everything skipped, stubbed or unverified along the way is in **[DEBT.md](DEBT.md)**.

Phase 1 is the gate. Two items in Phase 2 (steps 4, 5) are marked UNVERIFIED and must be checked before that phase is written.

## Deliberately not in scope

- Rewriting InkOS's chapter pipeline. It works. Publications adopt its checks; it does not adopt publications' architecture.
- Hosted database. See Phase 7.
- New publication types beyond what exists, until the loop is proven generic (Phase 8.6).
