# Quire — Integration Plan

The living plan for turning the patched InkOS wrapper into one integrated app.
Follow it phase by phase; tick the checklists; a phase is done only when every
box is ticked and every test passes. Update this file as reality corrects it —
a plan that drifts from the code is worse than no plan.

**Principle: one engine.** InkOS's agent + tool table + pipeline runners are
the spine. Everything Quire adds becomes a provider, a tool, a runner
definition, or a skill *inside* it. Nothing new lives beside the engine, and
the runtime DOM-patch layer dies by the end.

**The target workflow (acceptance test for the whole plan):**

```
pick publication type → give topic prompt → engine + websearch + skills
  → full content → design decision → images needed? → ComfyUI generates
  → PDF needed? → Affinity builds from content + design spec + images
```

**Ground truth discovered during the audit (do not re-litigate):**

- InkOS source is public: `github.com/Narcooo/inkos`, AGPL-3.0-only.
  `packages/{core,studio,cli}`.
- InkOS is an agent with a tool table (`core/src/agent/agent-session.ts`,
  `agent-tools.ts`): `research_web` (Tavily, traceable reports),
  `use_skill`, `sub_agent`, and one `*_create` tool per publication type,
  each backed by a runner in `core/src/pipeline/`.
- 43 model providers already exist (`core/src/llm/providers/endpoints/`),
  including offline: `ollama.ts`, `lmstudio.ts`. Only the CLI class is missing.
- Skills: loader (`INKOS_SKILL_DIRS`), REST API (`/api/v1/skills`), UI
  (ProjectSettings), and a `use_skill` agent tool all exist.
- Quire's cli-shim has real, working: CLI adapters (claude/codex/devin/agy),
  MCP client, ComfyUI install+generate, Affinity driver, magazine pipeline.
  All of it terminates at the Studio boundary because integration was a DOM
  patch instead of the source.

---

## Phase 0 — Fork and own the source

Fork `Narcooo/inkos` → `bsbbera/inkos`. Quire builds `core` + `studio` from
the fork; the global-npm dependency (`npm i -g @actalk/inkos`) is dropped.
The Quire rename happens **in source**; every runtime rename hack is deleted.
InkOS attribution stays, in source, per AGPL.

### Work
- [ ] Fork created; builds locally (`pnpm install && pnpm build`)
- [ ] Desktop shell spawns the fork's Studio instead of the npm package
- [ ] Rename in source: wordmark, `<title>`, breadcrumbs, strings
- [ ] Quire mark (arcs) replaces the InkOS logo in source
- [ ] AGPL attribution visible in sidebar, in source, naming InkOS Studio
- [ ] Delete from studio-patch: `early` rename script, `renameInkos`,
      `brandSidebar`, `trimCrumb`
- [ ] CI builds the fork; release/updater pipeline still works
- [ ] Upstream remote kept (`upstream` → Narcooo/inkos) for future merges

### Tests
| # | Test | Pass condition |
|---|---|---|
| 0.1 | Cold launch | Window titled Quire; no "InkOS" flash at any point |
| 0.2 | `grep -ri inkos` over rendered DOM | Only hit: the AGPL attribution |
| 0.3 | In-app update from previous version | Installs, relaunches, fork build runs |
| 0.4 | Existing workspace (`~/InkDesk` or `~/Quire`) | Books/works all present |
| 0.5 | `git merge upstream/main` dry-run | Conflicts limited to branded files |

---

## Phase 1 — Models: CLI as a real provider class

Add CLI provider endpoints beside Ollama/LM Studio/Anthropic in
`core/src/llm/providers/endpoints/`. Catalogue served live from the shim's
detection (`server.mjs` AGENTS table), which remains the process owning CLI
child processes. The `.env` + import-env "Env LLM" hack is deleted.

### Work
- [ ] Endpoints: `claude.ts`, `codex.ts`, `devin.ts`, `antigravity.ts`
- [ ] Live model catalogue from shim `/v1/models`; fallback lists kept
- [ ] Per-model capability flags: vision / tools / pdf
      (e.g. devin/kimi-* vision on; devin/glm-5-2 vision off)
- [ ] Studio Model Config lists CLI providers natively, with status
- [ ] Offline providers verified reachable in UI (Ollama, LM Studio)
- [ ] Delete: writeEnvModel/import-env poke; drawer model picker points at
      Studio's own Model Config

### Tests
| # | Test | Pass condition |
|---|---|---|
| 1.1 | Model Config page | Shows claude, codex, devin, agy groups with models |
| 1.2 | Select `devin/glm-5-2`, chat | Reply streams; footer shows real provider name, not "Env LLM" |
| 1.3 | Capability gate | Image attach disabled for glm-5-2, enabled for kimi |
| 1.4 | `claude update` then refresh | New version reflected without app restart |
| 1.5 | Ollama running locally | Its models listed and usable |
| 1.6 | Kill a CLI mid-generation | Clean error in chat, no hang |

---

## Phase 2 — Tools for CLI models

The CLI **is** the agent runtime: it executes tools itself. Quire exposes its
tools (research, publication, comfy, affinity, and InkOS's own) to the CLIs
over MCP — they all speak it. The existing `mcp.mjs` client keeps the reverse
direction: external MCP servers wrapped as `AgentTool`s for InkOS's agent.

### Work
- [ ] MCP **server** in the shim exposing Quire/InkOS tools to CLI agents
- [ ] CLI launch config injects that server (per-CLI mechanism)
- [ ] Structured protocols surfaced: devin ACP + claude stream-json tool
      events → Studio's ToolExecutionSteps UI
- [ ] External MCP servers (codex config, Claude Desktop extensions,
      ~/.inkos/mcp.json) wrapped as AgentTools for API/offline models
- [ ] Capability-gating: tool-less model → pipeline routes around or warns

### Tests
| # | Test | Pass condition |
|---|---|---|
| 2.1 | `claude/opus`: "research topic X" in chat | `.inkos/research/*.md` written with ≥3 sources |
| 2.2 | Tool events visible | ToolExecutionSteps shows the call + result |
| 2.3 | API model (e.g. ollama) + external MCP tool | Tool call executes through the wrap |
| 2.4 | Tool-less model in a research step | Warning, not a silent hallucinated report |
| 2.5 | MCP toggle off | Tool disappears from both directions |

---

## Phase 3 — Skills: builtin retained, user section added

Builtin skills untouched. `INKOS_SKILL_DIRS` points at a Quire skills folder
plus `~/.claude/skills`, so the same files refined in Claude Code are what the
app loads. Studio's existing skills UI is the management surface.

### Work
- [ ] `INKOS_SKILL_DIRS` set by the shell at launch (Quire dir + ~/.claude/skills)
- [ ] Skills listed in ProjectSettings; enable/disable/import verified
- [ ] Malformed SKILL.md surfaces a diagnostic, not a crash
- [ ] Relevant skills advertised to the agent so `use_skill` fires

### Tests
| # | Test | Pass condition |
|---|---|---|
| 3.1 | ProjectSettings skills list | mag-content, mag-design, affinity visible as user skills |
| 3.2 | Builtin skills | Still present and loadable |
| 3.3 | Chat: task matching a user skill | Agent calls `use_skill` with it |
| 3.4 | Edit SKILL.md on disk | Change visible after refresh, no restart |
| 3.5 | Break a SKILL.md frontmatter | Diagnostic in UI; other skills unaffected |

---

## Phase 4 — Publication types as definitions, one generic runner

One `publication-runner.ts` in `core/src/pipeline/` (modelled on
`script-storyboard-runner.ts`) driven by a **definition file**: sections, page
grammar, pacing, output format, prompt pack, needs-images, needs-pdf. One
`publication_create` agent tool. Sidebar entries and chat composers are
generated from installed definitions. Magazine becomes definition #1; the
overlay dies.

### Work
- [ ] Definition schema written and validated (JSON/YAML + zod)
- [ ] Generic runner: research → plan → design → write → art → build,
      stages declared by the definition
- [ ] `publication_create` tool registered in the agent tool table
- [ ] Sidebar + composer generated from definitions (real Studio pages)
- [ ] Magazine definition ported from `magazine.mjs`:
      research stage calls `research_web` (real search, traceable sources);
      voice/pillars come from the mag-content skill, not inline prompts
- [ ] Cookbook definition written as the second type (proves the abstraction)
- [ ] Delete: `magazine.mjs` engine, `mag.js`/`mag.css` overlay,
      `/mag/*` routes in `server.mjs`, `styles.mjs` (folds into definitions)

### Tests
| # | Test | Pass condition |
|---|---|---|
| 4.1 | Magazine via chat composer | Full run completes; output equals old engine's quality |
| 4.2 | Research provenance | Issue's research stage cites URLs from real search |
| 4.3 | New definition file + restart | Cookbook appears in sidebar; full flow runs |
| 4.4 | Back/forward/deep-link on publication pages | Real routes; Studio nav unaffected |
| 4.5 | Old overlay | `document.querySelector('.mag-root')` → null everywhere |
| 4.6 | Definition with `needs-images: false` | Pipeline skips art, no Comfy start |

---

## Phase 5 — ComfyUI: integral, installed by default

ComfyUI ships with the app. First-run installer (with the boot cover's
progress UI) sets it up with **one default workflow** around a light model
that runs on CPU and fits a 6 GB GPU — candidates (SD1.5-class,
flux-schnell GGUF quant) are **benchmarked on the target machine before
choosing, not guessed**. Registered as an image provider beside
gpt-image-2/Gemini so covers and publication art can select it; also exposed
as an explicit tool. Users add workflows; the default is not removable.

### Work
- [ ] First-run install step with per-stage progress + % (download, extract,
      model fetch), resumable on failure
- [ ] Default workflow chosen by benchmark; committed as a named, locked entry
- [ ] GPU detected → GPU-optimised settings; no GPU → CPU settings
- [ ] Registered in `cover-providers` as a provider
- [ ] `comfy_generate` agent tool for explicit calls
- [ ] Workflow manager UI: add / select / delete (default undeletable)

### Tests
| # | Test | Pass condition |
|---|---|---|
| 5.1 | Fresh machine, no ComfyUI | First run installs with visible progress |
| 5.2 | Cover generation, provider = ComfyUI | Image produced locally |
| 5.3 | CPU-only machine | Generation completes (slow is fine, hang is not) |
| 5.4 | 6 GB GPU | Generation completes without OOM |
| 5.5 | Kill install mid-download, relaunch | Resumes or restarts cleanly |
| 5.6 | Add custom workflow | Selectable; default still present and locked |

---

## Phase 6 — Design system (learning) + Affinity (executor)

Cleanly split taste from execution. The **design-system skill** owns colour,
type, grid, layout, image direction, and emits a **design-spec JSON** as the
pipeline's Design Decision. The **Affinity tool is a pure executor** taking
that spec. A feedback loop distils the user's hand-edits into approved rules
written back into the skill — taste compounds across builds.

### Work
- [ ] design-spec JSON schema: palette, type scale, grid, per-page layout,
      image slots — validated before build
- [ ] Design Decision stage in the runner emits the spec via the skill
- [ ] `affinity_build` tool: spec in, document out
      (`affinity.mjs` refactored from issue-shaped to spec-shaped)
- [ ] Taste loop: diff final vs. spec → candidate rules → per-rule user
      approval → rules written into the design-system SKILL.md
- [ ] Memory: approved rules persist and apply to the next build

### Tests
| # | Test | Pass condition |
|---|---|---|
| 6.1 | Full run with needs-pdf | Affinity builds the document from the spec |
| 6.2 | Invalid spec | Build refuses with a pointed schema error |
| 6.3 | Hand-edit a build, run taste | Diff detected; rules proposed per change |
| 6.4 | Reject a rule | Not persisted, not applied next build |
| 6.5 | Approve a rule | Next build reflects it without being asked |
| 6.6 | Non-magazine type with needs-pdf | Same executor works (spec-shaped, not issue-shaped) |

---

## Phase 7 — Quire UI: the Folio design system

A design system built for reading and writing, applied in the fork's source
(`packages/studio/src/index.css` + components) — not injected. Working name:
**Folio** — a page in the hand.

**Direction** (references: iA Writer's restraint, Readwise Reader's reading
surfaces, Literata's screen-serif work):

- **Type first.** Reading text in a real screen serif (Literata or
  Source Serif 4 — variable, OFL, shipped as files); UI chrome in Geist.
  A modular scale with a named role for every size; measure capped at
  ~68ch on all reading surfaces; generous leading.
- **Paper and ink, not panels.** Surfaces are paper tones; near-black warm
  ink; hierarchy from type and space before boxes and borders. Light mode is
  the reading mode and gets designed first; dark mode is an equal, not an
  inversion.
- **One accent**, used for actions and progress only — never decoration.
  (Aurora's wash retires; a manuscript doesn't glow.)
- **Chrome recedes while writing**: sidebar and toolbars quiet down when the
  composer or a reading pane has focus.
- **Tokens once**: every colour/size/space value is a CSS variable in the
  fork; the desktop shell (boot cover, drawer) consumes the same tokens.
  Delete the mirrored-literals arrangement.

### Work
- [ ] Token set defined in fork source (colour, type roles, space, radius)
- [ ] Fonts shipped: reading serif + Geist, subset, `font-display: swap`
- [ ] Reading surfaces (chapter reader, book detail, publication pages)
      restyled: measure, leading, paper
- [ ] Writing surfaces (chat/composer) restyled: focused mode, quiet chrome
- [ ] Sidebar, Model Config, Settings aligned to tokens
- [ ] Shell (boot cover, drawer, updater UI) consumes the same tokens
- [ ] Dark mode designed (not just inverted); both modes pass contrast
- [ ] Delete: `patch.css` theme block, `app.css` mirrored literals,
      remaining `studio-patch/` styling

### Tests
| # | Test | Pass condition |
|---|---|---|
| 7.1 | Every text colour on its surface | WCAG AA (4.5:1 body, 3:1 large) in both modes |
| 7.2 | Reading measure | No reading surface exceeds ~68–72ch |
| 7.3 | Hardcoded colours | `grep -E '#[0-9a-f]{3,8}|oklch\(' src/**` outside the token file → 0 hits |
| 7.4 | Font loading | No FOIT; fallback stack renders sanely offline |
| 7.5 | Shell vs. workbench | Boot cover → Studio: same paper, same ink, no visible seam |
| 7.6 | Focus/keyboard | Visible focus ring on every interactive element |
| 7.7 | prefers-reduced-motion | All non-essential animation off |
| 7.8 | 1366×768 laptop + wide desktop | Layouts hold at both |

---

## Phase 8 — Collapse and ship

- [ ] `cli-shim/studio-patch/` deleted entirely
- [ ] `server.mjs` reduced to: CLI process owner, MCP bridge, Comfy/Affinity
      hosts — nothing UI-shaped
- [ ] Fork source published (AGPL obligation covered; private use by you and
      your friend is fine — the obligation runs to those who receive builds)
- [ ] README rewritten: architecture as it now is
- [ ] Version bump, release, in-app update from the previous version verified

### Final acceptance test (the workflow, end to end)
| # | Step | Pass condition |
|---|---|---|
| F.1 | Pick "Magazine" in sidebar | Real Studio page opens with composer |
| F.2 | Type a topic brief | Parsed; run starts; progress visible |
| F.3 | Research stage | Real web search; sources traceable in the issue |
| F.4 | Skills | mag-content voice applied via use_skill (visible in tool steps) |
| F.5 | Content | All pages written to the definition's grammar |
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
  tests run on the real installed app, not the dev tree.
- Verification is done by looking (live DOM, real runs), never by assuming.
- Order rationale: 0 unlocks source-level work; 1–2 make models real;
  3–4 are the core ask; 5–6 the creative payload; 7 the face; 8 the cleanup.
- Token foundation note: Phase 0 keeps existing styling as-is; Phase 4's new
  pages use Studio's existing components so Phase 7 restyles once, not twice.
