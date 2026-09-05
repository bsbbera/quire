# 01 — What Works Today

Status of every subsystem, from code review. ✅ solid, 🟡 works with caveats, 🔴 broken/missing.

## Model layer (cli-shim/server.mjs, harness.mjs, tool-calls.mjs)

| Item | Status | Notes |
|---|---|---|
| OpenAI-compatible `/v1/chat/completions` (stream + JSON) | ✅ | Clean SSE, heartbeats every 15 s for long tool loops |
| Claude Code adapter (`stream-json`) | ✅ | Handles `is_error` on exit 0; env sanitized so parent keys don't leak |
| Codex adapter (`exec --json`) | ✅ | Live model list via `codex debug models`, with fallback list |
| Devin adapter (ACP JSON-RPC over stdio) | ✅ | Full session flow, auto-permission (`allow_always`), 5-min idle guard |
| Antigravity adapter (plain stdout) | 🟡 | No structured errors; non-zero exit gives raw stderr only |
| Host-owned tool channel (```tool_call fences) | ✅ | `parseToolCalls` / `streamableUpTo` are well tested; CLIs get **no** MCP servers by default (`QUIRE_CLI_OWN_TOOLS` gate) — this is the right security boundary |
| Binary discovery / 30 s re-detect | ✅ | Picks up installs without restart |
| Model selection persisted in Studio config | ✅ | Single source of truth (`PUT /api/v1/services/config`); the old `.env` copy-step was correctly removed — but `ui.html` still shows the stale `.env` text |
| Test coverage | ✅ | `test.mjs`, `harness-live.mjs`, self-checks in harness/tool-calls, `mcp-config.test.mjs` — genuinely good coverage for a project this size. One empty check ("unknown cli is rejected", test.mjs:81) |

## MCP hub (mcp.mjs)

| Item | Status | Notes |
|---|---|---|
| One-time import from Claude Desktop / Codex / Devin configs into `~/.inkos/mcp.json` | ✅ | Tested; secrets stay out of git |
| List / call tools, enable/disable servers over HTTP | ✅ | JSON-RPC over stdio, process lifecycle handled |
| Codex TOML parsing | 🔴 | Regex-based; breaks on multiline arrays / quoted commands |
| Config staleness | 🟡 | Imported paths can rot; no revalidation or health-per-server UI |

## ComfyUI (comfy.mjs, comfy-install.mjs, workflows.mjs)

| Item | Status | Notes |
|---|---|---|
| Discovery of portable installs, GPU tiering (nvidia-smi → gpu/lowvram/cpu) | ✅ | Windows-only (C:/D:/E: scan, `.bat` runners) |
| Installer with resumable downloads, bsdtar extraction | ✅ | ~11 GB Z-Image Turbo stack |
| Templated workflow system (`{{prompt}}`, `{{model.unet}}`), builtin + user workflows, validation | ✅ | Best-designed extension point in the codebase |
| Generate → poll history → fetch → save to caller's `outFile` | ✅ | Benchmark endpoint sets GPU tier |
| Image metadata / recipe persistence | 🔴 | The prompt/seed/workflow used are **not** stored beside the image → cannot "remake with same taste" (see 04, 09) |

## Affinity (affinity.mjs, affinity/tk.js)

| Item | Status | Notes |
|---|---|---|
| MCP bridge (`execute_script` via Canva Affinity MCP, SSE :6767) | ✅ | Preamble handshake handled; auto-launch via MSIX shell id |
| TK toolkit: grid math, palette, type faces, primitives, curves, motifs, text pour, placeholders, guides | ✅ | Impressive scope; ~600 lines of layout capability |
| Full-issue PDF build + per-page builds (memory-aware) | ✅ | Desktop staging workaround for sandbox is handled |
| Column text pour via binary-search on `overflows()` | 🟡 | Works but slow (no native text flow between frames) |
| `renderPage()` PNG export | 🔴 | Explicitly marked UNVERIFIED in code |
| Component/asset reuse across scripts | 🔴 | Every `execute_script` is a fresh context; shapes are rebuilt every time (see 07) |
| Hardcoded MSIX id, fonts, A4/6-col grid | 🟡 | Grid change = refactor, per tk.js's own comment |

## InkOS Studio (bundled runtime)

| Item | Status | Notes |
|---|---|---|
| Book pipeline (architect→writer→auditor→reviser→exporter), truth-file canon with authority tiers | ✅ | The strongest part of the product |
| Chapter lifecycle, approval gates, word counts, audit issues | ✅ | |
| Publication (magazine) pipeline: research→plan→write→fact-check→audit→art→build, copy/design/build gates, feedback endpoint | ✅ | Verified by `publication-test.mjs` (approval withdrawal on rewrite, plan/design checks incl. contrast ratio) |
| Production registry (book/short/script/storyboard/interactive-film/publication/play/translation) | ✅ | Clean output-dir-per-type model |
| EPUB export, cover providers, play-world image gen | ✅ | `epub-gen-memory`, `/api/v1/cover/*` |
| `confirmed-production` safety gate (buttons/slash only) | ✅ | Good agent-safety design |
| studio-patch: Quire oklch theme, Geist font, resizable panels, live progress panel (SSE `/api/v1/events`) | 🟡 | Works, but is a runtime monkey-patch |
| Chinese→English runtime translation (~415-entry dict + regexes + MutationObserver) | 🔴 fragile | Any upstream string change shows raw Chinese; this is the biggest UX landmine |

## Ops

| Item | Status | Notes |
|---|---|---|
| `deploy.ps1` copy+restart | ✅ | Correctly documents the two-copies trap; but hardcodes the store package name |
| Doctor (8 checks, severity + fix text) | ✅ | Good; model-dir scan handles real Comfy folder names |
| Magazine store migration (`migrate-magazine.mjs`) | ✅ | Safe (no overwrite w/o `--force`) |
| macOS/Linux | 🔴 | Nothing runs off Windows |

## Summary

**Working end-to-end today (on a correctly-set-up Windows machine):** pick a CLI model →
write a book or magazine in Studio with gates and audits → generate art locally with
ComfyUI → lay out and export a print PDF via Affinity. That full chain exists and is
mostly tested — a real achievement.

**The three weakest legs:** (1) no persisted image/design *recipes* (kills reproducibility
and feedback), (2) fresh-context Affinity scripting with zero reuse (kills speed and
consistency), (3) the patched-translation Studio UI (kills polish). These are exactly
the subjects of files 04, 07, and 02.
