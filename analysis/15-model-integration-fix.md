# 15 — Model Integration Fix: Implementation Spec

> Goal (user's words): the model should behave like Open Design's — an LLM that
> understands the app's context and the user's ask, invisibly. Not "a different
> software" bolted on. Harness and tool calls perfected.
> Files: `cli-shim/server.mjs`, `harness.mjs`, `tool-calls.mjs`, `mcp.mjs`,
> Studio services config. Tests: `test.mjs`, `harness-live.mjs` extended.
> Verified context (2026-08-30): the engine source at
> `vendor/studio/packages/core/src` already has `agents/` (36 files), `agent/` (13),
> `llm/`, and `production/harness.ts` — the engine has named agents and its own LLM
> layer. The app already has an **agent→model routing block in ProjectSettings.tsx**
> (mock 41-project keeps it there — "connections ≠ routing" is design law). So the
> router below is NOT a new UI concept: it unifies the shim's model choice with the
> engine's existing per-agent routing, one mechanism, surfaced in ProjectSettings.
> CONFIRMED since: the engine mechanism is `ProjectConfig.modelOverrides[agentName]`
> resolved in `runner.ts resolveOverride()` — see plan 21 for the unified routing
> table (profiles = agent names) and plan 20 for the shared provider seam.

## Why it feels like separate software today (root causes)

1. Model choice lives in a separate launcher page, saved into Studio services config,
   displayed nowhere in the working UI; stale `.env` copy is still described in ui.html.
2. One global model for every job — the app never chooses; the user must think about
   models at all times instead of never.
3. Tool calling is a fenced-text protocol the CLIs follow imperfectly; failures show
   up as raw prose/stderr, not app states.
4. No session/context continuity — every request is a fresh prompt rebuild; the CLI
   re-reads everything; long pipelines feel slow and disconnected.
5. Errors, retries, and timeouts differ per CLI adapter (antigravity has none).

## Target architecture

```
Studio pipeline stage ──► ModelRouter ──► Session (per production, per macro-stage)
                                             │ persistent CLI process (where possible)
                                             ▼
                                      Harness v2 (tool loop OWNED HERE)
                                        │ executes tools directly (comfy/affinity/mcp/fs)
                                        ▼ returns final structured result
```

Key shift: **the shim stops being a dumb OpenAI proxy and becomes the agent runtime.**
Today the tool loop is split — the shim parses `tool_call` fences but returns them to
the caller (Studio) to execute, adding a round trip through prompt-rebuild per tool
step. Move the loop into the shim.

## 1. ModelRouter (kills "which model?" as a user concern)

New: `cli-shim/router.mjs`.

```js
// routes.json (workspace .quire/routes.json, user-editable, hot-reloaded)
{
  "profiles": {
    "architect":  { "needs": ["strong-reasoning", "long-context"] },
    "writer":     { "needs": ["long-output"] },
    "auditor":    { "needs": ["strong-reasoning"] },
    "destyle":    { "needs": ["cheap"] },
    "artplan":    { "needs": ["vision-optional", "cheap"] },
    "factcheck":  { "needs": ["cheap", "web-optional"] },
    "chat":       { "needs": [] }
  },
  "catalog": {                     // capability tags per <cli>/<model>, shipped defaults
    "claude/opus":   ["strong-reasoning","long-context","long-output"],
    "claude/sonnet": ["long-output","cheap-ish"],
    "claude/haiku":  ["cheap"],
    "codex/*":       ["strong-reasoning"], …
  },
  "pins": { "writer": "claude/sonnet" }   // user override wins, per profile
}
```

- Profile names MUST align with the engine's existing agent names (architect, writer,
  auditor, reviser, exporter — see `core/src/agents/`), so the engine's per-agent
  routing and the shim's profiles are the same table, not two.
- `resolve(profile) -> "<cli>/<model>"`: pins → capability match against *detected*
  CLIs → global default. Falls back gracefully when a CLI is missing.
- Pipeline executors (14) call `chat(profile, messages, tools)` — they never name
  models. The chat UI uses profile `chat`.
- `POST /config` (model save) becomes `PUT /routes` (pins). Validate the pin against
  the CLI's live catalog (fixes the accept-anything bug). Keep `/config` as a shim
  that writes a pin, for backward compat.
- UI (02): pins surface in **ProjectSettings** (existing agent→model block, restyled
  per mock 41-project); provider connections stay in ServiceList/Detail (mock 30/31).
  The topbar pill shows the *chat* profile's resolution.

## 2. Harness v2 — the tool loop moves in

File: `harness.mjs` (extend), new `tool-registry.mjs`.

### 2.1 Tool registry (host-owned, scoped)

```js
// tool-registry.mjs
register("comfy_generate", schema, async (args, ctx) => comfy.generate(...));
register("affinity_page",  schema, async (args, ctx) => affinity.buildPage(...));
register("read_truth", "write_page", "search_research", "mcp_call", …)
```

- Each pipeline stage declares its allowlist (14 §executor ctx): artplan gets
  `search_research` only; design.generate gets comfy tools; build gets affinity
  tools. Chat gets a safe default set. (Closes the everything-visible-always gap.)
- JSON-schema validation on arguments before execution; validation failure returns a
  structured tool error the model can correct — never a crash.

### 2.2 The loop

`runTurn({ profile, messages, tools, ctx })`:
1. `buildPrompt` (existing) with the scoped tool table.
2. Spawn/reuse CLI session, stream.
3. On `finishTurn` → `tool_calls`: execute **in the shim** via the registry,
   append results as tool turns, continue the same session (see §3) — loop until a
   plain-text finish or `maxToolSteps` (default 12, per-stage override).
4. Return `{ text, toolTrace[], usage, model }`. Stream intermediate states as SSE
   deltas typed `thinking|tool:start|tool:done|text` — exactly the states the
   Vermilion run-thread UI renders (mock: sThink/sTool/sToolDone/sStream/sDone/sFail).

### 2.3 Robustness (perfecting the fence protocol)

- **Malformed fence recovery**: on unparseable `tool_call` block, send back one
  corrective tool-turn ("your call failed to parse: <error>; re-emit valid JSON") —
  max 2 attempts, then structured failure. (Today: silently treated as prose.)
- **Echo guard**: strip model-echoed tool results re-emitted as fences (dedupe by
  call id).
- **Timeout ladder** per stage: firstEvent 120s, idle 300s, total per-turn cap from
  stage config; on timeout, kill + mark job `failed(resumable)` — uniform across all
  four adapters (antigravity today has none: add `cliError` handling + exit-code
  mapping there).
- **Structured errors**: every adapter failure → `{ code: "cli-exit|timeout|
  parse|refusal", detail, stderrTail }`. Studio maps codes to the `.fail` UI pattern
  ("Nothing was lost…"). No raw stderr in chat ever.
- **Idempotent tools**: registry executions carry `jobId:step` keys; re-running a
  resumed turn skips already-completed side-effectful calls (comfy/affinity) by key.

## 3. Sessions & context (the "understands the app" part)

New: `cli-shim/sessions.mjs`.

- **Session = (productionRef, macroStage).** Devin/ACP: keep the ACP session open
  across turns (protocol supports it — today we tear down per request). Claude:
  use `--resume <session-id>` (claude CLI supports resumed sessions) or fall back to
  conversation replay. Codex: `exec` is one-shot → replay, but cache the built prompt
  prefix so rebuild is cheap.
- **Context pack** (assembled by Studio per stage, passed as system): production
  truth files (authority-tiered, already exist), style packs (05), world spec (08),
  pipeline position ("you are writing unit 7 of 12; units 1–6 summary: …"), and the
  relevant SKILL.md (17). One assembler: `quire-core/src/context/pack.ts` — today
  each runner does its own, inconsistently; unify.
- **Chat that knows where it is**: the Studio chat panel sends
  `{ profile:"chat", ref: currentProduction }`; the context pack is attached, so
  "make chapter 5 tenser" needs no explanation. Free-text still has no execution
  authority (confirmed-production gate stays; the model *proposes* actions as
  buttons the user clicks).

## 4. Cleanups (small, do first)

1. Delete dead `agentServers()` wiring from CLI args (footgun).
2. Fix ui.html stale `.env` text (ui.html is deleted at the end of 02's waves).
3. Real TOML parser (`smol-toml`) in `mcp.mjs`.
4. `req.on("error")` + body size caps on all POSTs.
5. Devin ACP: report close-reason instead of silent `[]` model list.
6. `test.mjs:81` empty check — implement or remove.

## 5. Implementation order

| # | Task | Test |
|---|---|---|
| 1 | Cleanups §4 | existing test.mjs green |
| 2 | tool-registry + schema validation | new self-check: bad args → corrective turn |
| 3 | Harness v2 loop (execute-in-shim), claude adapter first | harness-live: comfy_generate executes inside shim, single request |
| 4 | Structured errors across all 4 adapters + SSE state deltas | kill CLI mid-turn → `{code:"cli-exit"}` + resumable |
| 5 | Sessions (ACP persistent; claude resume; codex prefix cache) | 3-turn conversation reuses session, measurably faster |
| 6 | ModelRouter + routes.json + `PUT /routes` + validation | pin invalid model → 400; profile resolution matrix test |
| 7 | Context pack assembler in quire-core, used by all runners | writer prompt contains truth+style+position for every type |
| 8 | Pipeline executors (14) switch to `chat(profile,…)` | end-to-end book run never names a model |
| 9 | ProjectSettings routing block + topbar pill (02) | UI shows per-profile resolution live |

Acceptance: a user never selects a model to make a book; the chat understands "this
issue/page/chapter" without paste; a tool failure shows a friendly recoverable card;
one HTTP request per stage turn regardless of tool count; all four CLIs behave
identically from the app's point of view.
