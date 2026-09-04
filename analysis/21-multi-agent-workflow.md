# 21 — Multi-Agent Workflow: Roster, Per-Agent Models, Coordination

> Verified 2026-08-31: the engine is ALREADY multi-agent. `core/src/agents/` has 36
> files of class agents extending `BaseAgent` (`agents/base.ts`): Architect, Planner,
> Composer, Writer, ContinuityAuditor, Reviser, Polisher, StateValidator,
> FoundationReviewer, StyleAnalyzer, Researcher, Radar, Detector, short-fiction and
> script/storyboard agent sets. **Per-agent models already exist**:
> `ProjectConfig.modelOverrides: Record<agentName, string | AgentLLMOverride>`
> (`models/project.ts`), resolved by `PipelineRunner.resolveOverride(agentName)`
> (`runner.ts:669-715`, caches a dedicated LLMClient per override, supports custom
> baseUrl/apiKeyEnv). Coordination today: `runner.ts` hardwires the sequence; workers
> are single-turn (`worker-agent.ts`, tools:[]), the chat session is the only full
> tool loop (`agent-session.ts`, pi-agent-core, 5-min cache, sub_agent tool exists).
> The mock shows this in 41-project (agent→model mapping) and 09-run (one transcript
> for all stages).
>
> So the plan is NOT "build multi-agent" — it is: **complete the roster, unify the
> two routing tables, make coordination declarative (the 14 orchestrator), and make
> every agent visible and steerable in the UI.**

## 1. The roster (target)

| Agent | Exists? | Role in the macro-pipeline (14) | Default profile→model tier |
|---|---|---|---|
| Architect | ✅ | content.plan (books) — foundation | strong-reasoning |
| Planner | ✅ | content.plan per unit (ChapterIntent/Memo) | strong-reasoning |
| Composer | ✅ | context/rule-stack assembly (not an LLM heavy) | cheap |
| Researcher | ✅ | content.research (publications) | cheap + web |
| Writer | ✅ | content.write | long-output |
| ContinuityAuditor | ✅ | content.audit | strong-reasoning |
| Reviser | ✅ | content revise + destyle rewrites | long-output |
| Polisher | ✅ | optional polish pass | cheap |
| StateValidator | ✅ | truth persistence check | cheap |
| FactChecker | ✅ (fact-check.ts fns) | content.factcheck | cheap + web |
| Destyler | 🟡 (detection-runner + deslop skill) | content.destyle — formalize as agent wrapping pack-driven slop score (19 §5) | cheap |
| **ArtDirector** | ➕ NEW, **per-type behavior** | design.artplan — turns approved content + world into image briefs (slot + treatment taxonomy, 09) + page specs (14 §6, 13 §4). Books: few slots (openers/tailpieces/plates), one world; magazine: per-page briefs; storyboard: panels. Reuses the ALREADY-GENERIC DesignSpec + designReferences() mood board (publication-design.ts) — one agent, type-tuned prompts, not one agent per type | strong-reasoning |
| **ImageSmith** | ➕ NEW (thin) | design.generate — brief → Comfy recipe → generate → sidecar; retries with prompt nudges | cheap (mostly tool calls) |
| **DesignAuditor** | ➕ NEW | design.review machine pre-screen — validator rules + render checks (13 §9) | vision-capable |
| **AffinityBuilder** | ➕ NEW (thin) | build.layout/export — spec→TK program→Affinity via shim tools; no creativity, max determinism | cheap (tool executor; LLM only for error recovery) |
| Exporter | 🟡 (harness commits) | build.export non-Affinity targets (epub/typst) | none (pure code) |

Rules: **thin agents stay thin** — ImageSmith/AffinityBuilder are tool executors with
an LLM only for recovery/nudging; don't let creativity leak into build stages.
New agents are `BaseAgent` subclasses bound to stages via 14 §2.2's executor table.

## 2. One routing table (kills the current two-brain problem)

Today there are two independent mechanisms: engine `modelOverrides[agentName]`
(direct API models) and the shim's global CLI model (plan 15 adds profiles). Unify:

1. **Profiles ARE agent names.** 15's `routes.json` profile keys become exactly the
   roster names above (architect, writer, auditor…). One vocabulary everywhere.
2. **Resolution order** for agent X on a call:
   `modelOverrides[X]` (explicit pin, engine or UI) → capability match among
   *available* backends (detected CLIs via shim + configured API providers) →
   project default. Implemented once, in the engine's provider seam (20 §P1);
   the shim's router (15 §1) becomes the CLI-availability oracle it queries.
3. **Backend-agnostic pins**: a pin is `"claude/sonnet"` (CLI via shim) or
   `"openai/gpt-5"` (direct AgentLLMOverride) — same field, the seam dispatches.
4. **UI**: ProjectSettings' existing agent→model block (mock 41) lists the full
   roster with: resolved model, pin dropdown (grouped: CLI subscriptions / API keys),
   capability warnings ("DesignAuditor pinned to a non-vision model"), per-agent
   token spend (from 20 §4 telemetry). Provider *connections* stay in mock 30/31.
5. **Per-production override**: `pipeline.json` may carry `modelOverrides` for one
   book/issue (e.g. this novel's Writer = opus) — merged over project config.

## 3. Coordination model (declarative, not hardwired)

- The **orchestrator (14)** owns sequence: stages → agents via the executor table.
  `runner.ts`'s hardwired chains shrink to executor registrations. No agent ever
  calls another agent directly; hand-off is always `artifact → next stage`.
- **Two loop types stay** (this is a good design, keep it):
  - *Worker turns* (single-turn, schema-validated via 20 §S1) for pipeline agents.
  - *Session loop* (pi-agent-core tool loop) ONLY for chat and for the two agents
    that genuinely need iterative tool use: ArtDirector (queries assets/worlds) and
    AffinityBuilder recovery. Sessions keyed by (ref, stage) per 15 §3.
- **Review pairs, not committees**: each producer has exactly one checker
  (Writer↔Auditor, ArtDirector↔DesignAuditor, code-validators for AffinityBuilder).
  No N-agent debates — cost and latency without evidence of quality.
- **Escalation rule**: when a producer↔checker pair loops `maxIterations` (pack-set,
  19) without passing, the unit goes to the human gate with the disagreement
  attached — never silent retry-forever.

## 4. Visibility (make multi-agent feel like one machine)

- Run view (mock 09) transcript labels each block with the agent's name + model pill
  (`Writer · claude/sonnet`); stage dots per 14. One transcript, many hands.
- Rail run card shows current agent; "waiting on you" shows which checker sent it.
- Analytics (mock 36): per-agent spend/latency/pass-rate from 20's telemetry —
  this is where a user sees that e.g. Auditor-on-haiku fails 3× more than on sonnet
  and re-pins accordingly (evidence-driven routing, the human version of learning).

## 5. Implementation order

| # | Task | Test |
|---|---|---|
| 1 | Profile names = agent names; provider seam resolution (with 20 §P1, 15 §1) | same pin honored via CLI and direct API |
| 2 | ProjectSettings roster UI (restyle existing block, add capability warnings) | pin Writer→opus, run, transcript shows it |
| 3 | Destyler formalized (wraps 19's pack slop-score + reviser anti-detect mode) | destyle stage runs as agent w/ own model |
| 4 | ArtDirector + executor binding (14 §6) | approved chapter → briefs artifact |
| 5 | ImageSmith + DesignAuditor (needs 13 render + 09 recipes) | page candidates + pre-screen verdicts |
| 6 | AffinityBuilder (wraps 07's spec→TK path as agent w/ recovery turns) | build stage survives one induced script error |
| 7 | Per-production overrides + agent/model labels in run view | issue-level Writer pin visible in transcript |
| 8 | Analytics per-agent panel | spend/pass-rate rows render from telemetry |
