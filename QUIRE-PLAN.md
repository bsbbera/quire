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

## Phase 2 — Publication types run on the harness path

**Why.** `PublicationAgent extends BaseAgent` (`agents/publication.ts`) — `BaseAgent` calls `runWorkerAgent`, the toolless path. `AskFn` returns raw JSON from a single completion. No tools reachable from any stage.

`runAgentSession` (`agent-session.ts:1064`) is a plain exported async function, already driven headlessly by the test suite. Nothing prevents the pipeline from using it. (Verified.)

**Steps.**

1. Add `"publication"` to `SessionKindSchema` (`interaction/session.ts:6` — 10 kinds today, none fit). Tool table and system prompt both key off session kind.
2. Tool set for that kind in `createModeTools` (`agent-session.ts:825`).
3. Replace `AskFn` with `runAgentSession`. Retire `PublicationAgent extends BaseAgent`.
4. **UNVERIFIED, check before writing step 3:** `runAgentSession` takes `bookId: string | null`. Publications live in `Magazine/issues/`, not `books/`. Determine whether the null-book path survives a 40-page run, or whether an issue needs a book-shaped handle.
5. **UNVERIFIED:** `pipeline: PipelineRunner` is required and chapter-shaped. Confirm a publication run can supply one without dragging in chapter state.
6. Generalize: whatever makes publications work must work for any type. No magazine-specific branch in the session path.

**Done when.** A magazine and a short story both go through `runAgentSession`, same loop, differing only in which tools their session kind exposes.

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

## Phase 4 — Gates hold, MCP ships default

**Steps.**

1. Kill the bypass. `quire_affinity_build` (`cli-shim/mcp-server.mjs:96-118`) calls `affinity.build()` directly, skipping `requireApproval`, `requireDesignApproval`, `checkSpec` — the three gates `publication-runner.build()` enforces. Route it through the runner. Likely the path the shipped magazine took.
2. Gates enforce host-side, in the tool body, never by prompt. Model asks; host decides.
3. Approval needs a real surface (Phase 6). A gate with no UI is a deadlock.
4. **Affinity MCP ships with the app package.** Bundled, registered, enabled on first run — not something the user wires up. Visible in the MCP page as a default server.
5. MCP page lists bundled vs discovered servers distinctly, so a default that fails to start is obvious rather than silently absent.

**Done when.** A build attempted without design approval fails at the host — on both transports, from both the tool path and the MCP path.

---

## Phase 5 — The checks, as defaults

This is the substance. Everything above is plumbing to make this reachable.

**Steps.**

1. `audit` stage cannot be skipped. Today `stopAt` can stop short of it.
2. **37-dimension audit for publications.** Chapters get `ContinuityAuditor` (`pipeline/runner.ts:1299,1378,1448`). Publications get nothing. Port it or write the publication equivalent — dimensions differ for a magazine, the mechanism does not.
3. **De-AI-ification.** `analyzeAITells` runs for chapters. `publication-audit.ts` calls it, but the stage is reachable on paper only.
4. **Revise loop.** An audit that finds 18 problems and fixes 0 is a report. Findings feed a revise pass, which re-audits, bounded rounds.
5. Both checks default for every type, not opt-in per type.
6. Regression harness: re-run the shipped magazine, findings must drop measurably.

**Done when.** A fresh magazine run produces findings, revises, and re-audits without anyone asking it to.

---

## Phase 6 — Studio reachability

Today: one tool (`publication_create`), two routes, both GET (`studio/src/api/server.ts:4039,4059`). No approve, resume, build, or re-run anywhere.

**Steps.**

1. Issue detail route + page — stages, findings, artifacts, current gate state.
2. Approve / reject controls wired to Phase 4 gates. Content approval and design approval separate.
3. Resume from stage. A run stopped at `write` is currently unrecoverable.
4. Page previews, fed by `affinity_render` (Phase 3.3).
5. Feedback input on a page or section, submitting into the Phase 3.6 loop.

---

## Phase 7 — Memory and state parity

### Database: no server needed

**SQLite. Local file. Zero server, zero cost, already in the app.**

`memory.db` already exists at `join(bookDir, "story", "memory.db")` (`state/memory-db.ts:76`) and six chapter-pipeline modules use it. Quire is a desktop app — the database belongs on disk next to the work, not behind a network. No hosting decision, no free tier to pick, no account, works offline, backs up by copying a file.

If cross-device sync is ever wanted, the SQLite-compatible option is Turso (free tier); Postgres alternatives are Neon and Supabase (both free tier). **Not recommended now** — each adds an account, a network dependency, and a failure mode, to solve a problem a single-machine desktop app does not have. Revisit only if Quire actually runs on two machines.

**Steps.**

1. Rescope `memory.db` from book-scoped to work-unit-scoped, so any publication type gets one. Same schema, different root.
2. Retrieval into publication context. Today every page is written cold — no memory of what earlier pages established.
3. Zod schema for `publication.json`. Hand-rolled validation covers *definitions* only; issues are unvalidated. Non-negotiable once tools mutate issues.
4. Atomic writes on every tool path. Tools mutate more often than fixed stages did.

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
1 ─→ 2 ─→ 3 ─→ 5 ─→ 4 ─→ 7 ─→ 6 ─→ 8
```

Phase 1 is the gate. Two items in Phase 2 (steps 4, 5) are marked UNVERIFIED and must be checked before that phase is written.

## Deliberately not in scope

- Rewriting InkOS's chapter pipeline. It works. Publications adopt its checks; it does not adopt publications' architecture.
- Hosted database. See Phase 7.
- New publication types beyond what exists, until the loop is proven generic (Phase 8.6).
