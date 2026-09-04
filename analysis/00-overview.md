# Quire — Architecture Overview & Master Plan

> Analysis date: 2026-08-28. Based on full code review of `cli-shim/` (server, harness,
> mcp, comfy, affinity, workflows, studio-patch, tests) and the bundled `inkos/` runtime
> (`quire-inkos-runtime` v1.8.0, `@actalk/quire-core`, Studio SPA + Hono API).

## What Quire is today

```
┌─────────────────────────────────────────────────────────────────┐
│  quire.exe (packaged desktop shell)                             │
│    │                                                            │
│    ├── cli-shim (Node, port 8787)                               │
│    │     • OpenAI-compatible API over agent CLIs                │
│    │       (claude / codex / devin / antigravity)               │
│    │     • Launcher UI (ui.html)                                │
│    │     • MCP hub (~/.inkos/mcp.json + imported configs)       │
│    │     • ComfyUI adapter + installer (port 8188)              │
│    │     • Affinity bridge (MCP execute_script, port 6767)      │
│    │     • Doctor / preflight                                   │
│    │                                                            │
│    └── InkOS Studio (Hono + React SPA, port 4567)               │
│          • Books, chapters, truth files, publications           │
│          • Pipeline agents: architect→writer→auditor→reviser    │
│          • Magazine pipeline: research→plan→write→fact-check    │
│            →audit→art→build                                     │
│          • studio-patch (Quire theme, EN translation, progress) │
│                                                                 │
│  Workspace: ~/Quire (books/, Magazine/, worlds/, workflows/…)   │
└─────────────────────────────────────────────────────────────────┘
```

The core idea is strong and unusual: **use agent CLI subscriptions the user already
pays for (Claude Code, Codex, Devin) as the LLM engine** of a creative publishing
studio, plus **local** image generation (ComfyUI) and **real** print layout (Affinity).
Nothing on the market combines these four things.

## File map of this analysis

| File | Topic |
|---|---|
| `01-what-works.md` | Current working state, per subsystem, with gaps |
| `02-ui-improvement.md` | **Impl spec — START HERE**: 47-screen Vermilion mock (`analysis/mock/`) → existing React app, screen-by-screen waves |
| `03-integration.md` | Model / MCP / Affinity / skills / ComfyUI integration audit + fixes |
| `04-organisation.md` | Workspace & asset organisation, per-story image libraries, feedback loops |
| `05-writing-styles.md` | Multi-style writing system: taxonomy, storage, prompt integration |
| `06-design-style.md` | Layout/grid/type/cutout rules; golden rules & rule-breaking; feedback system |
| `07-affinity.md` | Affinity pipeline: component reuse, build optimisation |
| `08-design-system.md` | Buildable design system: movements × techniques × prop worlds, in-app UI |
| `09-image-generation.md` | ComfyUI + alternatives (offline & API), in-app UI question |
| `10-reader.md` | Book-style Reader UI plan (OYLA-like flipbook) |
| `11-future-platforms.md` | macOS, mobile/iPad, extra features, sellability |
| `12-per-type-workflows.md` | The canonical spine (prompt→content→gates→design→art→build) mapped per production type; stage-graph registry plan |
| `13-magazine-master-plan.md` | Dedicated magazine plan: per-section worlds, page bundles, per-page redesign loop, beauty gate |
| `14-pipeline-fix-implementation.md` | **Impl spec**: orchestrator + stage graph — Content→gate→Design→gate→Build auto-advancing for every type; job queue; events |
| `15-model-integration-fix.md` | **Impl spec**: ModelRouter profiles (= engine agents), harness v2 (tool loop in shim), sessions, structured errors |
| `17-skills-and-tools.md` | **Impl spec**: mojibake/Chinese fixes (skills + engine prompts), skill upgrades, external-loader exposure, tool registry |
| `18-taste-engine-implementation.md` | **Impl spec**: capture→distill→approve→apply auto-learning for styles/worlds/skills |
| `19-audit-evolution.md` | **Impl spec**: audit packs (versioned criteria per type), per-type audit upgrades, audit learning loop + bench guard |
| `20-harness-improvement.md` | **Impl spec**: unify shim/engine provider seam, structured-output hardening, atomic commits + observations everywhere, telemetry |
| `21-multi-agent-workflow.md` | **Impl spec**: agent roster (+ArtDirector/ImageSmith/DesignAuditor/AffinityBuilder), one per-agent model routing table, declarative coordination |

**UI sources of truth:** `analysis/mock/` (47 screens + `vermilion.css` + contracts in
`index.html`) and `Quire-Dev/design/vermilion-redesign-plan.md`. The app frontend
already exists at `Quire-Dev/vendor/studio/packages/studio` (React 19 + Tailwind v4,
Vermilion tokens landed in `src/index.css`) — plans 02 and 14–18 build on it, not from
scratch. Files 01–13 are analysis/concept; 02 and 14–18 are the implementation specs.

## The honest verdict on sellability

**Yes, sellable — but not yet.** The engine (InkOS pipeline, publication gates,
approval flow, truth-file canon) is genuinely production-grade in design. What
blocks a sale today:

1. **Windows-only everywhere** — hardcoded drives, `.bat` runners, MSIX Affinity id,
   `System32\tar.exe`, PowerShell deploy. (See `11-future-platforms.md`.)
2. **Three disjoint UIs** — launcher (ui.html), Studio (patched Chinese SPA),
   and no reader. A buyer sees the seams instantly. (See `02-ui-improvement.md`.)
3. **Setup friction** — needs 4 CLI installs, an 11 GB model download, an Affinity
   license, and specific Windows fonts. Doctor exists but there's no guided
   onboarding flow.
4. **Studio is a patched fork** — the runtime translation dictionary (~415 strings)
   and regex HTML patching are maintenance debt that will break on any upstream
   update.

## Implementation order (decided; each step is detailed in its file)

| Phase | Plan | Work |
|---|---|---|
| 1 | **02 — UI** | Shell + Wave 1 daily-driver screens from the mock; English-first strings; kill patch.js/ui.html as waves complete |
| 2 | **14 — Workflow** | Orchestrator + stage graph + gates + job queue + events (Content→Design→Build auto-advance for every type) |
| 3 | **15 — Model** | ModelRouter profiles, harness v2, sessions, structured errors |
| 4 | **17 — Skills/tools** | Mojibake + Chinese prompt extraction, skill upgrades, tool registry |
| 5 | **18 — Taste engine** | Auto-learning loops over the now-existing gates |
| 6+ | Remaining concept plans as features | 04 assets/sidecars, 08 worlds, 09 images, 13 magazine deep-loop, 10 reader, 07 affinity reuse, 11 macOS |

Note: 02's Wave 4/5 screens and 18 depend on 14/15 APIs — the phases interleave;
the order above is where each effort *starts*, not a strict waterfall.

## One architectural principle to adopt everywhere

**Everything is a spec file + a registry.** The codebase already does this well in
two places (Comfy `workflows/*.json`, publication definitions in quire-core). Extend
the same pattern to: writing styles, design worlds, Affinity components, image
recipes, reader themes. One folder, one JSON schema, validated at load, user-extensible,
and every generated artifact records *which spec produced it* so it can be remade.
