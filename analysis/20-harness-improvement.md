# 20 — Harness Improvement Plan

> There are **two harnesses** and one provider layer; the word "harness" must stop
> meaning three things. Verified 2026-08-31:
> 1. **Shim harness** — `cli-shim/harness.mjs` + `tool-calls.mjs`: builds prompts for
>    agent CLIs, parses ```tool_call fences, returns calls to the caller. (Plan 15
>    already upgrades this to "harness v2": tool loop executed in-shim, sessions,
>    corrective turns, structured errors. This file does not repeat 15 — it adds to it.)
> 2. **Engine production harness** — `core/src/production/harness.ts` (119 lines):
>    NOT an LLM harness; it's the persistence/observability boundary —
>    `ProductionObservation {metric, expected, actual, severity, repairable}`,
>    `createRangeObservation()`, and `commitProductionArtifacts()` (atomic multi-file
>    commit so a run never points at a half-written set).
> 3. **Engine LLM provider** — `core/src/llm/provider.ts` (~1760 lines):
>    `chatCompletion()` via pi-ai, `withTransientLLMRetry` (2 retries, linear backoff,
>    retries 429/5xx/partials, NOT model-not-available), stream deadlines (first event
>    120s/300s pipeline, idle 90s/180s), per-agent `AgentLLMOverride` clients cached in
>    `runner.ts resolveOverride()`; `worker-agent.ts` wraps it in single-turn pi-agent
>    workers (`tools: []` or one result tool); `agent-session.ts` runs the full
>    conversational tool loop with a 5-min agent cache.

## Goals

A. One request path regardless of whether the model is a CLI (shim) or an API
   (pi-ai) — same retries, same timeouts, same structured errors, same telemetry.
B. Structured outputs that never break the pipeline.
C. Observability: every LLM turn accountable (cost, latency, agent, unit, outcome).
D. The production harness (atomic commits + observations) adopted by ALL runners.

## 1. Unify the provider seam (engine side)

Today the engine reaches CLI models only because the shim pretends to be OpenAI.
Formalize it:

| # | Task | Detail |
|---|---|---|
| P1 | **Provider adapter registry** in `llm/provider.ts`: `direct` (pi-ai, exists) and `shim` (OpenAI-compatible → cli-shim). The shim adapter sets pipeline-grade deadlines and passes `profile` + `ref` headers (15 §3 context/session keys) | so shim sessions attach to the right production |
| P2 | **Uniform error taxonomy** across both adapters: `{code: transient|timeout|refusal|model-unavailable|parse|tool-failure, detail}`. Map shim's 15-§2.3 codes and pi-ai errors into it; `withTransientLLMRetry` keys off `code`, not string matching | one retry policy |
| P3 | **Budget guard** per call: `maxTokens` exists; add per-run token/cost ceiling (from pipeline.json) — a runaway revise loop stops with `budget-exceeded`, resumable | protects long books |
| P4 | **Cancellation**: thread one AbortSignal from job queue (14) → provider → shim child process kill. Provider already supports signals; the shim needs `DELETE /v1/runs/:id` | cancel actually cancels |

## 2. Structured output hardening (biggest day-to-day failure source)

Auditor/planner/settler all demand JSON or `=== TAG ===` blocks, parsed by bespoke
parsers (`writer-parser.ts`, `settler-parser.ts`, reviser `parseOutput`).

| # | Task | Detail |
|---|---|---|
| S1 | One `submitStructured(schema)` path (BaseAgent already has it — make ALL agents use it; kill ad-hoc `JSON.parse` sites) with: partial-json salvage (dep exists), schema validation, and **one corrective re-ask on failure** (same pattern as 15 §2.3, but engine-side) | malformed audit JSON stops killing runs |
| S2 | Tag-block grammar as a tiny shared parser (FIXED_ISSUES/PATCHES/REVISED_CONTENT etc.) with fuzz tests from logged real outputs | reviser patches stop silently dropping |
| S3 | Log every parse failure + salvage to `_telemetry/parse-failures.jsonl` — this corpus drives prompt fixes | measurable |

## 3. Production harness adoption (the good pattern, everywhere)

`commitProductionArtifacts()` (atomic set commit) and observations are used by the
long-fiction runner; publications and shorts write files piecemeal.

| # | Task |
|---|---|
| H1 | Publication runner writes page bundles + pipeline.json through `commitProductionArtifacts` — a crashed art stage never leaves a page half-updated (14's resume depends on this) |
| H2 | Every stage executor (14 §2.2) returns `ProductionObservation[]`; observations render in the run view (mock 09) as the "expected vs actual" rows — length bands, density mix, audit score all become visible metrics, not log lines |
| H3 | Extend `ProductionRunSnapshot` with `{model, profile, tokens, costEstimate, durations}` per stage — the analytics screen's "where is it stuck" (mock 36) reads this |

## 4. Telemetry (C)

- `_telemetry/llm.jsonl`: one line per turn `{at, agent/profile, model, ref, unit,
  tokensIn/Out, ms, outcome, retries}`. Written by the provider seam (both adapters).
- Surface: Analytics (mock 36) gains a "spend" panel; chapter meta already tracks
  tokenUsage — reconcile to one source.
- Privacy: never log prompt/content bodies by default; `QUIRE_LOG_PROMPTS=1` for debug.

## 5. Shim harness additions (delta over plan 15)

1. **Golden-transcript tests**: record real CLI streams (claude/codex/devin/agy) as
   fixtures; `extractDelta`/ACP parsing replayed against them in CI — today adapter
   regressions are only caught live.
2. **Capability probes** at detect time: 1-token ping per CLI to verify auth/session
   validity (not just binary presence) — doctor shows "installed but not logged in".
3. **Prompt-prefix cache** keyed by (ref, stage): rebuilds only the tail (new turns),
   measured win for codex replay mode.
4. **Backpressure**: cap concurrent CLI spawns at 1 (queue in 14 enforces); reject
   with `busy` + retry-after instead of silently serializing forever.

## 6. Order

P2 → S1 → H1 → P4 → S2 → H2 → telemetry → P1 → P3 → shim deltas (with 15's schedule).
Each lands with a test: taxonomy unit tests, structured-output fuzz corpus, kill-mid-
commit crash test proving atomicity, cancel-mid-generate test over HTTP (quire-ctl).
