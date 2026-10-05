# 20 — Harness & Models: pi as the Provider Seam, Zero-Touch Connection, Open Routing

## Revision 2026-10-05 — one Connections screen: API · CLI · Local (supersedes §3's screen)

**User decision:** the app offers all three ways to reach a model, like Open Design:
an **API** (key + base URL), an installed **CLI**, and a **Local/offline** server
(Ollama, LM Studio, any OpenAI-compatible URL). Every connection has **Test
connection**. Only a connection that passed its test feeds the model picker. This
replaces `PRODUCT.md`'s old "no API key field may exist" rule (updated the same day);
that rule is why this plan stalled — §3 needed an API option the product doc forbade.

**Why it is not there today (verified 2026-10-05)** — the parts exist, in three places:
- `pages/ServiceDetailPage.tsx` (InkOS legacy) — API key field, base URL, **Test
  connection**, lists models after a test. Routed at `#/services`, but no sidebar
  entry; reachable only from a chat link (`ChatPage.tsx:1472`). Chinese-first copy,
  old styling, ~45 vendor presets (`core/src/llm/providers/endpoints/`).
- `pages/SetupPage.tsx` → `Providers()` — CLIs only ("Detected from the CLIs
  installed on this machine"). No API, no local, no test button.
- `pages/ModelCombo.tsx` — already shows "only what is connected". So the gate
  exists; what "connected" means differs per path.
So: three systems, two screens, no single definition of "validated".

**Target**

```
Setup → Connections
  [API]    Anthropic · OpenAI · Google · OpenRouter · + Custom (base URL + key)
  [CLI]    Claude Code · Codex · Devin · Antigravity   (auto-detected)
  [Local]  Ollama · LM Studio · + Custom URL            (port probe)
  each row: status dot · [Test connection] · models found · last tested
```

Rules:
1. **One catalogue** — `providers.json` (§3 below), kinds `api | cli | local`. The
   shim, engine, Setup and picker all read it. Adding a provider = one JSON entry.
2. **One meaning of "validated"** — a test made a real call and listed ≥ 1 model.
   Stored per connection with a timestamp. Picker shows validated models only;
   a failed test shows the error and keeps the row out of the picker.
3. **Re-test cheaply on launch** (the existing 300 s / 15 s TTLs); a connection that
   stops answering greys out with the reason, it is never silently dropped.
4. **Keys** stay on this machine, in the store the Services page uses today (check
   where before building), never in `quire.json`, never in the workspace, never in git.
5. **Preset list ≠ code** — the 45 vendor endpoint files stop being the UI; the
   catalogue lists a short default set plus "Custom". The files can stay behind pi.
6. The old Services page is folded into Connections and its route removed.

**Status 2026-10-05 — built (dev):** `core/providers.json` (+ `~/.quire/providers.json`);
Settings → Connections with API · CLI · Local tabs, Test connection, models found,
last tested, custom URL; one "connected" = a passed test (`studio/src/api/connections.ts`),
stored in `~/.quire/connections.json`, re-tested in the background, a stopped
connection greyed with its reason in the model pickers; keys moved to
`~/.quire/secrets.json`; `#/services` pages removed (links land on Connections).
Checked over the HTTP API: wrong key → error, nothing saved, no models; right key →
models in the picker, key only in `~/.quire`; Ollama stopped → row kept with reason
and `lastOk`, out of the picker; no key at all → the four CLIs connected on a fresh
launch. **Not done:** the shim still keeps its own CLI list in code (it does not
read `providers.json`); §5 needs-based routing.

**Build order** (replaces §6 rows 1 and 4; rows 2, 3, 5–8 unchanged):
1. `providers.json` with `kind`, read by shim + engine + Setup.
2. Connections screen (three tabs) built from the Services page's test logic, in the
   app's shared components (02 revision).
3. `validated` flag + timestamp; `ModelCombo`/`ModelRouting` read only that.
4. Remove `#/services`; Chat's link points to Connections.
5. Later: §4 needs-based routing (pin → preset → needs), unchanged.

Test: fresh workspace → add an API key → Test → models appear in the picker; wrong
key → error shown, nothing in the picker; stop Ollama → its models grey out.

> Rewritten 2026-09-07; absorbs the former `15-model-integration-fix.md`. Verified:
> `cli-shim/server.mjs:266-347` (`AGENTS` array: claude `-p --output-format stream-json`,
> codex `exec --json`, devin ACP, antigravity plain), `:539-802` (`complete()`,
> heartbeat 15 s, idle kill 600 s), `harness.mjs:16-24,75-117` (fenced ```` ```tool_call ````
> convention — shim returns `tool_calls`, never executes), `errors.mjs:28-106` (8 error
> codes, mirrored in `core/src/llm/error-codes.ts`), `usage.mjs` (`usage.x_quire`),
> `preflight.mjs:31-56`, `agents.mjs` (`~/.quire/agents.json`),
> `core/src/llm/providers/endpoints/cliAgents.ts:30-87` (the four CLIs registered as
> `openai-completions` endpoints at `127.0.0.1:${SHIM_PORT}/<cli>/v1`),
> `core/src/llm/provider.ts` (~1760 lines; `chatCompletionViaPiAi()`, retry ×2, stream
> deadlines), `core/package.json:68-69` (**`@mariozechner/pi-ai` 0.67.1 + `pi-agent-core`
> 0.67.1 already dependencies**), `agent/worker-agent.ts`, `agent/agent-session.ts`
> (pi-agent-core tool loop), `llm/model-routing.ts:74-124` + `llm/agent-roster.ts:40-213`
> (26 agents, 7 jobs, `modelOverrides` in `inkos.json`), `pages/ModelRouting.tsx`.

## Status

| Piece | State |
|---|---|
| Shared error taxonomy shim ↔ engine, retry, stream deadlines, usage envelope | done |
| CLIs as ordinary provider endpoints (one picker for CLI + API + local) | done — a real unification the old plans did not foresee |
| Per-agent and per-job model pins with a UI | done (`ModelRouting.tsx`) |
| Capability tiers / auto-routing by what an agent needs | **no** — every pin is manual |
| Provider catalogue as data | **no** — a new CLI touches `server.mjs`, `cliAgents.ts`, `providers/index.ts`, `preflight.mjs` |
| Tool loop inside the shim, sessions, `routes.json`, tool registry (old 15) | not started — and **superseded** by §2 |
| pi | **pi-ai is already the engine's direct-API path**; the shim is a hand-rolled CLI wrapper beside it |
| Zero-touch connection (open app → pick models → done) | no — login state is per CLI, doctor reports binaries only |

## 1. What "harness" means here, precisely

Three things get called the harness and they should be separated:

1. **Transport** — how bytes reach a model: HTTPS API, OAuth-subscription API, or a
   spawned CLI (stdin/print, ACP).
2. **Agent loop** — tool calling, structured output, retries, streaming state.
3. **Production seam** — atomic artefact commits + observations (`production/harness.ts`, done).

The shim today does (1) for CLIs and fakes (2) with a text fence. pi does (1) for ~25
providers and (2) properly. The plan: **pi owns (1)+(2); the shim shrinks to the one
transport pi lacks — ACP.**

## 2. pi as the single provider seam — yes, and without losing capability

### What pi gives

`@earendil-works/pi-ai` (the maintained namespace; `@mariozechner/pi-ai` stopped at
0.73 in May 2026, current is **0.85.x**, Sept 2026) is a unified multi-provider LLM
API: streaming, tool calls with schema validation, model discovery, OAuth. Providers
include **Anthropic Claude Pro/Max and OpenAI ChatGPT Plus/Pro (Codex) via
subscription login**, GitHub Copilot, and API keys for Anthropic, OpenAI, Google,
Bedrock, Vertex, Mistral, Groq, OpenRouter, Ollama-style local, ~20 more. Custom
providers speaking OpenAI/Anthropic/Google APIs are added by a `models.json` entry.

### What that means for each of today's four CLIs

| Today | With pi | What changes for the user |
|---|---|---|
| `claude` CLI spawned per request | **native** Anthropic provider, subscription OAuth or API key | no CLI install needed; real token counts; real tool calls; JSON mode; no fence hack |
| `codex` CLI | **native** OpenAI provider (ChatGPT subscription or key) | same |
| `devin` (ACP) | **stays as ACP** through the shim, registered as a custom OpenAI-compatible provider in pi's `models.json` (which is exactly what `cliAgents.ts` does now) | unchanged |
| `antigravity` (plain stdin) | stays in the shim as a plain adapter; or ACP if/when it speaks it | unchanged |
| any future ACP agent (Gemini CLI, pi itself via `pi-acp`, Zed-style agents) | **generic ACP adapter** — one JSON entry `{id, bin, protocol:"acp"}` | plug-in by config, no code |

**Nothing is lost.** The shim already does not hand MCP servers to the CLIs
(`QUIRE_CLI_OWN_TOOLS` defaults off) and already returns `tool_calls` to the engine
instead of executing them — so Claude Code's internal tools/skills were never in use.
The engine's own tool loop (`agent-session.ts`, on pi-agent-core) is what runs tools.
What is gained: native structured output, correct `finish_reason`, usage on every
provider, cancellation via `AbortSignal` end to end, and one code path instead of
four adapters plus a parser.

**Risk to state plainly:** subscription OAuth for third-party tools has been
contested by providers before (Anthropic restricted non-Claude-Code use of Claude
OAuth tokens in 2025; pi's README lists the subscriptions as supported today). Keep
the **CLI transports as a fallback**, selectable per provider in Settings
("Connect via: subscription login · API key · installed CLI"), so a policy change
degrades to today's behaviour rather than breaking the app. This is also why the shim
does not disappear.

### Architecture after the change

```
engine (core/src/llm)
  provider.ts  ──► pi-ai  ──► Anthropic / OpenAI / Google / Ollama / OpenRouter / …   (direct)
                          └─► "acp-shim" custom provider ──► cli-shim ──► ACP agents (devin, …)
                                                                        └► plain adapters (agy)
                                                                        └► CLI fallbacks (claude -p, codex exec) when chosen
  agent loop   ──► pi-agent-core (exists: worker-agent.ts, agent-session.ts)
```

Upgrade path: bump both pi packages to `@earendil-works/*@0.85` (breaking changes are
likely between 0.67 and 0.85 — `chatCompletionViaPiAi` and `worker-agent.ts` are the
two touch points), then move Anthropic/OpenAI from `cliAgents.ts` endpoints to pi
native providers behind a per-provider "connect via" switch.

## 3. Zero-touch connection: open the app, pick models, done

The user's requirement is that connection is automatic and invisible. Concretely:

**Provider catalogue as data** — `providers.json` (ships in core, user-extendable in
`~/.quire/providers.json`), the *single* source the shim, engine, preflight and UI
read. Removes the four-file edit for a new provider.

```json
{ "id": "devin", "label": "Devin", "transport": "acp",
  "bins": ["devin", "%LOCALAPPDATA%/devin/cli/bin/devin.exe"],
  "auth": { "probe": ["devin","auth","status"], "login": ["devin","login"] },
  "models": { "discover": "acp" }, "fallback": ["adaptive"] }
{ "id": "anthropic", "label": "Claude", "transport": "pi",
  "auth": { "kinds": ["oauth","api-key","cli:claude"] } }
```

**Discovery at launch** (a `connect` job, runs in the background, ≤ 3 s per provider,
results cached with the 300 s / 15 s TTLs that exist):

1. pi providers: read pi's auth store (OAuth tokens, keys) → connected / not.
2. ACP/plain providers: resolve `bins` → run `auth.probe` → connected / installed-but-
   signed-out / missing.
3. Local servers (Ollama, LM Studio): port probe.
4. For each connected provider, discover models (pi does this itself; ACP via
   `session/new` as today).

**One screen: Connections** (replaces the CLI toggles in Settings):

```
Claude        ● connected via subscription        [Switch to API key] [Disconnect]
ChatGPT       ○ not connected                     [Sign in]  [Use API key]
Devin         ● connected (CLI 1.9)               
Antigravity   ◌ installed, signed out             [Sign in]   ← runs `agy login` in a terminal pane
Ollama        ● 4 models                          
+ Add provider (OpenAI-compatible URL · ACP binary)
```

"Sign in" runs the provider's OAuth device flow (pi exposes `login` programmatically)
or the CLI's own login in an embedded terminal; on success the model list fills in.
No file editing, no port numbers, nothing typed twice.

**Models page then only asks the one question the user cares about:** *which model
does each job use* — with a working default (below), so "done" can mean accepting
defaults.

## 4. Open routing: capabilities in, choices out

Today every pin is a manual `agent → model`. Make the default automatic and the
override rare by adding two data facts and one resolver step:

**Model capabilities** (from pi's catalogue where present; else `providers.json`):
`reasoning: 1–5`, `speed: 1–5`, `cost: 1–5`, `context: tokens`, `vision: bool`,
`json: bool`, `tools: bool`.

**Agent needs** in the roster (`agent-roster.ts`), one line each:

| Agent / job | needs |
|---|---|
| Architect, Planner, Writer, Reviser | `reasoning ≥ 4, context ≥ 100k` |
| Auditor / Reviewer | `reasoning ≥ 4, json` |
| Destyler, Setting-card compressor, style analyzer LLM pass | `speed ≥ 4, cost ≤ 2` |
| Researcher, Fact-checker | `tools, context ≥ 100k` |
| ArtDirector, DesignAuditor, Image↔text coherence | `vision` |
| Chat | user's pick |

**Resolver**: `pin → preset → needs-match`. A **preset** is the user's one global
knob — *Best · Balanced · Frugal* — mapping each `needs` profile to the best-scoring
connected model (Best maximises reasoning, Frugal minimises cost subject to needs).
Pins still win. The Models page shows the **resolved table** with the reason for each
row ("Frugal → Haiku: speed 5, cost 1, meets Destyler needs") and a per-production
override in `pipeline.json.modelOverrides` for one-off runs (plan 21). This is the
"open" structure: providers, models, capabilities, needs are all data; the resolver is
30 lines; nothing about a specific vendor lives in code.

**Budget guard** (was 20 P4): per-run token/cost ceiling from usage envelopes; the job
pauses at the ceiling and raises a card rather than failing.

## 5. Structured output, tools, sessions — what remains after pi

- **Structured output**: pi's tool-call schema validation gives `submitStructured(schema)`
  for free on native providers; ACP providers keep the parse-and-repair path. Every
  agent that returns JSON declares its schema (many already parse ad hoc).
- **Sessions**: pi-agent-core sessions per production unit (already how chat works);
  ACP sessions in the shim get reused per run instead of torn down per request
  (`acp()` creates one per call today — the slow first call is why the fallback list
  exists).
- **Tool registry**: one `agent-tools.ts` list with scopes per stage (which tools the
  Researcher, Writer, Auditor may see) — the engine already has the list; add the scope
  column and drop the MCP-per-CLI code paths in the shim.
- **Telemetry**: `_telemetry/llm.jsonl` per run from the usage envelope — feeds the
  cost meter in the UI and the budget guard.

## 6. Implementation order

| # | Task | Test |
|---|---|---|
| 1 | `providers.json` catalogue; shim `AGENTS`, `cliAgents.ts`, preflight read it | add an ACP entry by JSON only → appears in picker |
| 2 | Bump pi to `@earendil-works/*@0.85`; fix `chatCompletionViaPiAi`, `worker-agent.ts` | existing API-key providers unchanged |
| 3 | Native Anthropic/OpenAI via pi behind "connect via" switch; CLI path kept as fallback | same prompt, both paths, same tool-call shape |
| 4 | `connect` job + Connections screen + embedded login flows | fresh machine: sign in twice, models listed, no file edits |
| 5 | Capabilities + agent needs + preset resolver; Models page shows reasons | Frugal preset routes Destyler to the cheapest qualifying model |
| 6 | Generic ACP adapter + session reuse in the shim | Devin first-call latency drops; model list is live not fallback |
| 7 | `submitStructured` on native; tool scopes per stage | Auditor JSON parse failures → 0 on native |
| 8 | Budget guard + telemetry + cost meter | run pauses at ceiling with a card |
