# Quire — Integration Plan

The living plan for turning the patched InkOS wrapper into one integrated app.
Follow it phase by phase; tick the checklists; a phase is done only when every
box is ticked and every test passes. Update this file as reality corrects it —
a plan that drifts from the code is worse than no plan.

**Principle: one engine.** InkOS's agent + tool table + pipeline runners are
the spine. Everything Quire adds becomes a provider, a tool, a runner
definition, or a skill *inside* it. Nothing new lives beside the engine, and
the runtime DOM-patch layer dies by the end.

**Second principle: nothing working gets rewritten.** Most of the capability
already exists and is good. This plan **moves** it inside the engine. Where a
phase says "port", it means relocate and re-wire — not reimplement.

**The target workflow (acceptance test for the whole plan):**

```
pick publication type → give topic prompt → engine + websearch + skills
  → full content → design decision → images needed? → ComfyUI generates
  → PDF needed? → Affinity builds from content + design spec + images
```

---

## What already exists

### Ours — `cli-shim/` (3,418 lines) and `desktop/`

| Asset | Size | State | Verdict |
|---|---|---|---|
| CLI adapters — claude, codex, devin (ACP), antigravity | `server.mjs:124–230` | Working: live catalogues, binary detection, 30s cache, version-keyed invalidation | **Keep**, re-expose as providers (P1) |
| OpenAI-compatible endpoint + 4 stream parsers | `server.mjs:568+`, `complete()` | Working | **Keep**, extend for tools (P2) |
| MCP client — discovery + stdio JSON-RPC | `mcp.mjs` (236) | Working: reads Codex TOML, Claude Desktop extensions, `~/.inkos/mcp.json` | **Keep**, wrap as AgentTools (P2) |
| ComfyUI install + generate | `comfy.mjs` (146), `comfy-install.mjs` (190) | Working: GPU detect, disk check, download, extract, graph, generate | **Keep**, register as provider (P5) |
| Affinity driver | `affinity.mjs` (569), `affinity/tk.js` | Working, but issue-shaped | **Refactor** to spec-shaped (P6) |
| Magazine pipeline | `magazine.mjs` (953) | Working: research→plan→design→write→art→build, queue, resume, SSE, approval gates | **Port** to a definition + generic runner (P4) |
| Quality law — `checkPlan`, `checkDesign`, contrast rules | `magazine.mjs`, `styles.mjs` (141) | Working and genuinely valuable | **Port**, do not discard (P4/P6) |
| Doctor / preflight checks | `preflight.mjs` (133) | Working | **Keep**, extend (P5) |
| Test harness — ~30 assertions | `test.mjs` (288) | Working: status, models, streaming, parseJson, checkPlan, checkDesign, MCP discovery, comfy models, approval gates, queue resume | **Keep and extend** — this is the base for every phase's tests |
| Tauri shell — window, two child processes, boot cover with staged progress | `desktop/src-tauri`, `desktop/ui` | Working | **Keep** |
| Updater — minisign signing, CI release, in-app check/install/relaunch | `.github/workflows/release.yml`, `app.js` | Working end to end | **Keep** |
| Studio patch layer | `studio-patch/` (~1,900) | Working but structurally wrong | **Delete** progressively (P0, P4, P7) |

### Theirs — InkOS, already in the product, currently unused by Quire

| Capability | Where | Quire's current use |
|---|---|---|
| Agent + tool table (~25 tools) | `core/src/agent/agent-session.ts:1187`, `agent-tools.ts` | none |
| `research_web` → Tavily, traceable reports with sources | `agent-tools.ts:1282`, `utils/web-search.ts` | none — magazine uses model memory instead |
| `use_skill` + skills loader + REST API + Settings UI | `agent/skill-tool.ts`, `core/src/skills/`, `studio server.ts:4011` | none |
| Publication types as tools + runners | `script_create`, `storyboard_create`, `interactive_film_create`; `core/src/pipeline/*-runner.ts` | none — magazine is a parallel engine |
| 43 model providers, incl. offline `ollama.ts`, `lmstudio.ts` | `core/src/llm/providers/endpoints/` | bypassed by the "Env LLM" hack |
| Image providers | `core/src/llm/cover-providers.ts` | API-only; ComfyUI not registered |
| `sub_agent`, material ingest/retrieve, governed context | `agent-tools.ts`, `core/src/models/` | none |

### Not started

- **Fork of InkOS.** No fork on GitHub (`bsbbera` has none); nothing vendored
  in this repo. A shallow clone exists only in a session scratchpad and is
  temporary. **Phase 0 is genuinely from zero.**
- Publication-type definitions; design-spec schema; taste feedback loop;
  Folio design system.

---

## Phase 0 — Fork and own the source

Fork `Narcooo/inkos` → `bsbbera/inkos`. Quire builds `core` + `studio` from
the fork; the global-npm dependency (`npm i -g @actalk/inkos`) is dropped.
Branding moves **into source**; the runtime rename hacks are deleted.
InkOS attribution stays, in source, per AGPL.

**Reuse:** the branding decisions are already made and proven at runtime —
wordmark, arcs mark, "Quire Studio" title, breadcrumb trim, attribution
wording. Port those values; delete the machinery that applied them.

### Work
- [ ] Fork created; `pnpm install && pnpm build` succeeds locally
- [ ] Vendored or submoduled into the Quire build; shell spawns the fork's Studio
- [ ] Branding in source: wordmark, `<title>`, mark, breadcrumb, strings
- [ ] AGPL attribution in source, naming InkOS Studio
- [ ] Delete from `studio-patch/patch.js`: `renameInkos`, `brandSidebar`,
      `trimCrumb`; delete the `early` script from `studio.mjs`
- [ ] CI builds the fork; release + updater pipeline unchanged
- [ ] `upstream` remote kept for future merges

### Tests
| # | Test | Pass condition |
|---|---|---|
| 0.1 | Cold launch | Titled Quire; no "InkOS" flash at any frame |
| 0.2 | Live DOM scan for "InkOS" | Only hit: the AGPL attribution |
| 0.3 | In-app update from previous release | Installs, relaunches, fork build runs |
| 0.4 | Existing workspace (`~/InkDesk`/`~/Quire`) | Books and works all present |
| 0.5 | `git merge upstream/main --no-commit` | Conflicts confined to branded files |
| 0.6 | `node cli-shim/test.mjs` | All existing checks still pass |

---

## Phase 1 — Models: CLI as a real provider class

The adapters exist and work. This phase changes **where they are exposed**:
provider endpoints in the fork, beside Ollama and LM Studio, instead of a
single fake "Env LLM" service.

**Reuse:** `server.mjs:124–230` unchanged as the CLI process owner and
catalogue source. **New:** thin provider endpoints + capability flags.

### Work
- [ ] Endpoints `claude.ts`, `codex.ts`, `devin.ts`, `antigravity.ts` in
      `core/src/llm/providers/endpoints/`, catalogue fetched from the shim
- [ ] Per-model capability flags: vision / tools / pdf
      (devin/kimi-* vision on; devin/glm-5-2 vision off)
- [ ] Studio Model Config lists CLI providers natively, with detection status
- [ ] Offline providers verified reachable (Ollama, LM Studio)
- [ ] Delete `writeEnvModel` + import-env poke; drawer defers to Model Config
- [ ] Extend `test.mjs`: capability flags, provider listing

### Tests
| # | Test | Pass condition |
|---|---|---|
| 1.1 | Model Config page | claude / codex / devin / agy groups with real model lists |
| 1.2 | Select `devin/glm-5-2`, chat | Streams; footer shows the provider, not "Env LLM" |
| 1.3 | Capability gate | Image attach off for glm-5-2, on for kimi |
| 1.4 | `claude update`, refresh | New version picked up without app restart |
| 1.5 | Ollama running | Models listed and usable |
| 1.6 | Kill a CLI mid-generation | Clean error in chat, no hang |
| 1.7 | `test.mjs` | Existing model/status checks still pass |

---

## Phase 2 — Tools for CLI models

A CLI **is** an agent runtime — it executes tools itself. So Quire exposes its
tools to the CLIs over MCP (they all speak it) rather than translating a
protocol. The existing MCP client keeps the reverse direction.

**Reuse:** `mcp.mjs` discovery and JSON-RPC transport; the ACP and stream-json
parsers already in `complete()`. **New:** an MCP *server* face, AgentTool
wrappers, capability gating.

### Work
- [ ] MCP server in the shim exposing Quire/InkOS tools to CLI agents
- [ ] Per-CLI launch config injects that server
- [ ] Tool-use events from devin ACP + claude stream-json surfaced to Studio's
      `ToolExecutionSteps`
- [ ] External MCP servers wrapped as `AgentTool`s for API/offline models
- [ ] Capability gating: tool-less model → route around, or warn
- [ ] Extend `test.mjs`: tool round-trip per CLI

### Tests
| # | Test | Pass condition |
|---|---|---|
| 2.1 | `claude/opus`: "research topic X" | `.inkos/research/*.md` with ≥3 real sources |
| 2.2 | Tool visibility | ToolExecutionSteps shows call + result |
| 2.3 | Ollama + external MCP tool | Executes through the AgentTool wrap |
| 2.4 | Tool-less model in a research step | Warning, not a hallucinated report |
| 2.5 | MCP toggle off | Tool gone from both directions |

---

## Phase 3 — Skills: builtin retained, user section added

Entirely a wiring phase — the loader, API, UI and `use_skill` tool all exist.

### Work
- [ ] Shell sets `INKOS_SKILL_DIRS` = Quire skills dir + `~/.claude/skills`
- [ ] Verify list / enable / disable / import in ProjectSettings
- [ ] Malformed `SKILL.md` → diagnostic, not a crash
- [ ] Skills advertised to the agent so `use_skill` fires on intent

### Tests
| # | Test | Pass condition |
|---|---|---|
| 3.1 | ProjectSettings skills list | mag-content, mag-design, affinity present |
| 3.2 | Builtin skills | Still present and loadable |
| 3.3 | Task matching a user skill | Agent calls `use_skill` |
| 3.4 | Edit a SKILL.md on disk | Visible after refresh, no restart |
| 3.5 | Break its frontmatter | Diagnostic shown; other skills unaffected |

---

## Phase 4 — Publication types as definitions, one generic runner

The magazine pipeline is good work with real quality law in it. It is **ported**,
not rewritten: the same stages, the same `checkPlan`/`checkDesign` rules, the
same queue and resume semantics — relocated into a generic runner driven by a
definition file, with research swapped to the real `research_web` tool and
voice moved from inline prompts to the mag-content skill.

**Reuse:** stage logic, approval gates, queue/resume, SSE progress,
`checkPlan`, `checkDesign`, `styles.mjs` law, `parseJson` hardening.
**New:** definition schema, generic runner, `publication_create` tool,
generated sidebar/composer.

### Work
- [ ] Definition schema (sections, page grammar, pacing, output, prompt pack,
      needs-images, needs-pdf) + validation
- [ ] `publication-runner.ts` in `core/src/pipeline/`, modelled on
      `script-storyboard-runner.ts`
- [ ] Port stage logic, approval gates, queue/resume, progress events
- [ ] Port `checkPlan` / `checkDesign` / contrast law as definition-level rules
- [ ] `publication_create` registered in the agent tool table
- [ ] Sidebar entries + composers generated from installed definitions
      (real Studio pages, real routes)
- [ ] Magazine definition #1: research via `research_web`; voice via skill
- [ ] Cookbook definition #2 — proves the abstraction
- [ ] Delete: `magazine.mjs` engine, `mag.js`/`mag.css`, `/mag/*` routes
- [ ] Port `test.mjs` magazine checks onto the runner

### Tests
| # | Test | Pass condition |
|---|---|---|
| 4.1 | Magazine end to end | Completes; output quality ≥ the old engine's |
| 4.2 | Research provenance | Issue cites URLs from real search |
| 4.3 | Add a definition file, restart | Cookbook in sidebar; full flow runs |
| 4.4 | Back / forward / deep link | Real routes; Studio nav unaffected |
| 4.5 | Overlay gone | `.mag-root` absent everywhere |
| 4.6 | `needs-images: false` | Art skipped; ComfyUI never starts |
| 4.7 | Ported law | Illegal plan and unreadable palette still rejected |
| 4.8 | Stop mid-run, resume | Resumes its own remaining pages (existing test) |

---

## Phase 5 — ComfyUI: integral, installed by default

Installer and generator exist. This phase makes it **default and shared**:
installed on first run, registered as an image provider for the whole app.

**Reuse:** `comfy-install.mjs` (GPU vendor, disk check, download, extract),
`comfy.mjs` (graph, generate), `preflight.mjs` checks, boot-cover progress UI.
**New:** first-run step, benchmarked default workflow, provider registration,
workflow manager.

### Work
- [ ] First-run install step with per-stage progress + %, resumable
- [ ] Default workflow chosen by **benchmark on the target machine** — a light
      model that runs on CPU and fits 6 GB VRAM (SD1.5-class, flux-schnell
      GGUF quant as candidates); committed as a locked entry
- [ ] GPU present → GPU settings; absent → CPU settings
- [ ] Registered in `cover-providers` as a selectable image provider
- [ ] `comfy_generate` agent tool for explicit calls
- [ ] Workflow manager UI: add / select / delete; default undeletable

### Tests
| # | Test | Pass condition |
|---|---|---|
| 5.1 | Fresh machine, no ComfyUI | First run installs with visible progress |
| 5.2 | Cover generation, provider = ComfyUI | Image produced locally |
| 5.3 | CPU-only | Completes (slow is fine, hang is not) |
| 5.4 | 6 GB GPU | Completes without OOM |
| 5.5 | Kill install mid-download, relaunch | Resumes or restarts cleanly |
| 5.6 | Add custom workflow | Selectable; default present and locked |
| 5.7 | `test.mjs` comfy checks | Every workflow model has a download |

---

## Phase 6 — Design system (learning) + Affinity (executor)

Split taste from execution. The **design-system skill** owns colour, type,
grid, layout, image direction and emits a **design-spec JSON**. The **Affinity
tool is a pure executor** taking that spec. A feedback loop distils your
hand-edits into approved rules written back into the skill.

**Reuse:** `affinity.mjs` script generation, staging, page build, `tk.js`;
`styles.mjs` register/technique law and contrast maths. **New:** spec schema,
spec-shaped entry points, taste loop, rule persistence.

### Work
- [ ] design-spec JSON schema (palette, type scale, grid, per-page layout,
      image slots), validated before build
- [ ] Design Decision stage emits the spec via the skill
- [ ] `affinity_build` tool: spec in, document out — `affinity.mjs` refactored
      from `build(issue)` to `build(spec)`
- [ ] Taste loop: diff final vs. spec → candidate rules → per-rule approval →
      written into the design-system `SKILL.md`
- [ ] Approved rules persist and apply to the next build

### Tests
| # | Test | Pass condition |
|---|---|---|
| 6.1 | Full run with needs-pdf | Affinity builds from the spec |
| 6.2 | Invalid spec | Refused with a pointed schema error |
| 6.3 | Hand-edit, run taste | Diff detected; rules proposed per change |
| 6.4 | Reject a rule | Not persisted, not applied |
| 6.5 | Approve a rule | Next build reflects it unprompted |
| 6.6 | Non-magazine type with needs-pdf | Same executor works |

---

## Phase 7 — Quire UI: the Folio design system

A design system for reading and writing, applied in the fork's source
(`packages/studio/src/index.css` + components) — not injected. Working name:
**Folio** — a page in the hand.

**Reuse:** hard-won knowledge, not code — Studio's tokens are oklch not HSL;
its utilities are `!important` inside a cascade layer (so injected CSS loses,
and even inline loses to a running transition); Geist is already bundled and
loading. **New:** the token set and every restyle, in source. All patch CSS
is deleted.

**Direction** (references: iA Writer's restraint, Readwise Reader's reading
surfaces, Literata's screen-serif work):

- **Type first.** Reading text in a real screen serif (Literata or
  Source Serif 4 — variable, OFL, shipped as files); chrome in Geist. A
  modular scale with a named role per size; measure capped ~68ch on reading
  surfaces; generous leading.
- **Paper and ink, not panels.** Paper tones, warm near-black ink; hierarchy
  from type and space before boxes. Light mode is the reading mode and is
  designed first; dark mode is an equal, not an inversion.
- **One accent**, for actions and progress only — never decoration. Aurora's
  wash retires; a manuscript doesn't glow.
- **Chrome recedes while writing** — sidebar and toolbars quiet when the
  composer or a reading pane has focus.
- **Tokens once**, in the fork; the shell consumes the same tokens. The
  mirrored-literals arrangement between `patch.css` and `app.css` is deleted.

### Work
- [ ] Token set in fork source: colour, type roles, space, radius
- [ ] Fonts shipped: reading serif + Geist, subset, `font-display: swap`
- [ ] Reading surfaces restyled: measure, leading, paper
- [ ] Writing surfaces restyled: focused mode, quiet chrome
- [ ] Sidebar, Model Config, Settings aligned to tokens
- [ ] Shell (boot cover, drawer, updater) consumes the same tokens
- [ ] Dark mode designed, not inverted; both modes pass contrast
- [ ] Delete: `patch.css`, `app.css` mirrored literals, remaining patch styling

### Tests
| # | Test | Pass condition |
|---|---|---|
| 7.1 | Contrast, every text colour | WCAG AA (4.5:1 body, 3:1 large), both modes |
| 7.2 | Reading measure | No reading surface exceeds ~68–72ch |
| 7.3 | Hardcoded colours outside the token file | 0 hits |
| 7.4 | Font loading | No FOIT; sane fallback offline |
| 7.5 | Shell → workbench | Same paper and ink, no visible seam |
| 7.6 | Keyboard | Visible focus ring on every interactive element |
| 7.7 | `prefers-reduced-motion` | Non-essential animation off |
| 7.8 | 1366×768 and wide desktop | Layouts hold at both |

---

## Phase 8 — Collapse and ship

- [ ] `cli-shim/studio-patch/` deleted entirely
- [ ] `server.mjs` reduced to: CLI process owner, MCP bridge, Comfy and
      Affinity hosts — nothing UI-shaped
- [ ] `test.mjs` covers every surviving surface
- [ ] Fork source published (AGPL obligation runs to whoever receives builds;
      private use by you and your friend is unaffected)
- [ ] README rewritten to the architecture as it then is
- [ ] Release; in-app update from the previous version verified

### Final acceptance test (the workflow, end to end)
| # | Step | Pass condition |
|---|---|---|
| F.1 | Pick "Magazine" in the sidebar | Real Studio page with composer |
| F.2 | Type a topic brief | Parsed; run starts; progress visible |
| F.3 | Research | Real web search; sources traceable in the issue |
| F.4 | Skills | mag-content voice applied via `use_skill`, visible in tool steps |
| F.5 | Content | Every page written to the definition's grammar |
| F.6 | Design decision | design-spec JSON produced and stored |
| F.7 | Images | ComfyUI generates locally per the spec's slots |
| F.8 | PDF | Affinity builds from content + spec + images |
| F.9 | Repeat with "Cookbook" | Same flow, different definition, no new engine |
| F.10 | Taste | Hand-edit → rules proposed → approved rule applied next run |

---

## Sequencing and rules

```
0 fork ─→ 1 models ─→ 2 tools ─→ 3 skills ─→ 4 publications ─→ 5 comfy ─→ 6 design+affinity ─→ 7 UI ─→ 8 ship
```

- Each phase ends in a tagged release installable through the in-app updater.
- A phase is done when its checklist is fully ticked and its tests pass —
  run against the real installed app, not the dev tree.
- `cli-shim/test.mjs` is the regression base and must stay green in every
  phase; each phase adds to it rather than replacing it.
- Verification is by looking — live DOM, real runs — never by assuming.
- Order rationale: 0 unlocks source-level work; 1–2 make models real;
  3–4 are the core ask; 5–6 the creative payload; 7 the face; 8 the cleanup.
- Phase 4's new pages use Studio's existing components so Phase 7 restyles
  once, not twice.
