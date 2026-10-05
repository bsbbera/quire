# 24 — Centralisation: one registry, one screen, one pipeline (2026-10-05)

Models, UI and the magazine fail the same way: the parts exist, but each in more
than one place, so nothing is the single source. This file names the pattern and
points at the three plans that fix it. The work itself lives in those plans.

| Area | Today (verified 2026-10-05) | One place it becomes | Plan |
|---|---|---|---|
| Models | API test page (`ServiceDetailPage`, legacy, not in sidebar) + CLI-only Setup tab + picker with its own idea of "connected" | **Connections**: API · CLI · Local, Test connection, only validated models in the picker; `providers.json` | 20 revision |
| UI | 39 pages, 11 on Vermilion, 2 stylesheets, 593 inline styles, 246 `[px]`, motion in 24 scattered keyframes | **Shared components + tokens + `motion.css`**; working-state animations only for searching / planning / thinking / generating; guard count → 0 | 02 revision |
| Magazine | own 2,572-line runner beside the shared `SPINE`; issues often made outside Quire by the `mag-content` skill | **Shared pipeline** with publication executors; issues created only in Quire; brand book + connection web as the writing model | 13 revision |

## The rule for new work

1. **One registry per kind of thing.** Providers in `providers.json`; picture engines
   in `engines.json` (already); stages in `SPINE` (already); UI parts in
   `components/ui/`. Adding one = one entry, not edits in four files.
2. **One screen per job.** A setting lives on one screen; a second screen may link to
   it, never re-draw it.
3. **One pipeline.** A production type differs by its executors and unit shape, never
   by having its own runner or state file.
4. **Validated before visible.** Anything the user can pick (model, engine, world,
   kit item) is shown only after it has been checked to work.

## Order across the three

1. 20 → Connections (unblocks everything that needs a model).
2. 02 → foundation (tokens, components, `motion.css`), so Connections and the
   magazine screens are built once in the shared parts.
3. 13 → brand book and connection web (prompts/plan/audit), then runner → executors.
