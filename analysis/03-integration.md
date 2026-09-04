# 03 — Integration Audit: Models, MCP, Affinity, Skills, ComfyUI

## Current integration map (verified from code)

```
Studio pipeline ──(OpenAI API)──► cli-shim :8787 ──spawn──► claude/codex/devin/agy
     │                                │
     │ tools (host-owned)             ├──HTTP──► ComfyUI :8188 (workflows.mjs templates)
     │                                ├──MCP stdio──► Affinity bridge :6767 (execute_script + TK)
     │                                └──MCP stdio──► any server in ~/.inkos/mcp.json
     └──/api/v1/events (SSE)──► progress panel
```

Verdict per integration:

### Models — ✅ well integrated, minor fixes
- Correct single source of truth (Studio services config). Streaming, tool fences, env
  sanitization, ACP for Devin — all solid.
- **Fix:** validate the model against the CLI's catalog on `POST /config`; surface CLI
  errors (esp. antigravity) as structured JSON; remove the dead `agentServers()` wiring
  in the args arrays (footgun for accidental re-enable of CLI-owned tools).
- **Add:** per-model capability flags (context length, vision, cost tier) so the
  pipeline can auto-route: architect/auditor → strong model, writer → fast model,
  fact-check → cheap model. Today one model does everything — this is the single
  biggest quality/cost lever available.
- **Future:** direct API providers (user's own OpenAI/Anthropic/Gemini keys) as a
  5th "agent" — InkOS already supports them via pi-ai; the shim just needs passthrough.

### MCP — 🟡 works, needs hygiene
- Import-once from Claude Desktop/Codex/Devin configs is good; toggling works.
- **Fix:** replace the regex TOML parser (`mcp.mjs:28-45`) with a real one
  (`smol-toml`); add per-server health check (`tools/list` ping) shown in the Setup
  UI; re-import button; kill orphaned server processes on shim exit.
- **Add:** a small allowlist per pipeline stage — the art stage gets comfy+affinity
  tools only, the research stage gets search tools only. Today the tool table is
  whatever the caller sends; scoping it per-stage improves both safety and model focus.

### Affinity — 🟡 integrated, but stateless (see 07 for the full plan)
- The bridge, TK toolkit, staging, and PDF export work. Missing: verified PNG render,
  component reuse, non-hardcoded package id/port, font availability check in doctor.

### ComfyUI — ✅ best-designed integration, one gap
- The workflow registry (builtin + user JSON, validation, placeholder fill, model
  download plan) is the pattern the rest of the app should copy.
- **Gap:** no recipe persistence (prompt/seed/workflow/settings next to each image) —
  covered in 04 and 09.

### Skills — 🔴 not integrated at all (biggest missed opportunity)
You have a large personal library of relevant skills (mag-content, mag-design,
mag-taste, sbinkos/inkos, cookbook, seminar, illustration…). Quire's pipeline
re-implements some of this logic in quire-core, but there is **no skill mechanism
inside Quire itself**. Recommendation:

- Define `workspace/skills/<name>/SKILL.md` (same format you already use).
- The shim's `buildPrompt` already hoists system messages — add a `skill` field to
  pipeline stage configs; the stage's SKILL.md is prepended as system context.
- This gives users a way to teach the writer/designer their taste **without code**,
  and is the natural home for the taste-feedback loops in 05/06 (mag-taste's
  diff→rule→approve cycle is exactly the right model — port it in-app).

### Cross-cutting integration fixes (ordered)

1. **Config unification.** Today config lives in: Studio services config, `~/.inkos/mcp.json`,
   `<workspace>/.quire/comfy.json`, `inkos.json`, `.env`, env vars. Define one
   `workspace/quire.json` (with sections: providers, mcp, comfy, affinity, ui) and make
   the others derived/legacy. Doctor should print where every value came from.
2. **Event bus.** Studio has `/api/v1/events`; the shim has none. Add `/events` SSE to
   the shim (comfy install progress, affinity build progress, CLI detection changes)
   and merge both streams in the UI. Right now Comfy's 11 GB download has no live UI.
3. **Job queue.** Comfy generate, Affinity build, and chapter writes are all
   long-running but have three different execution models (HTTP-blocking, per-page
   calls, Studio runs). A single job table (id, kind, status, progress, log, artifact)
   surfaced in the UI makes everything cancellable and resumable.
4. **Path portability.** Centralize every hardcoded path (Affinity MSIX id, Comfy
   drives, CLI locations, Desktop staging) into one `platform.mjs` with per-OS
   implementations — prerequisite for the macOS port (11).

### Future possibilities (ranked by value/effort)

| Idea | Value | Effort | Note |
|---|---|---|---|
| Stage-specific model routing | ★★★ | S | Immediate cost/quality win |
| In-app skills | ★★★ | M | Unlocks taste loops |
| Direct-API providers | ★★ | S | Users without CLI subs |
| TTS/audiobook stage (edge-tts or local) | ★★ | M | Books → audio product |
| Translation productions already exist → multilingual issues | ★★ | S | Registry already has it |
| Vector search over truth files/research cache (sqlite-vec) | ★★ | M | Better continuity, dedupe |
| Print-on-demand export (Lulu/Blurb API PDF/X preset) | ★★ | M | Real revenue path for users |
| Video/motion (storyboard → interactive-film pipeline exists) | ★ | L | Later |
