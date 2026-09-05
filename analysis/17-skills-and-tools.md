# 17 — Skills & Tools: Localization Fix + Upgrade Plan

> Verified state (2026-08-30): SOURCE lives at
> `Quire-Dev/vendor/studio/packages/core/skills/` (15 skill dirs, 31 files) and the
> engine ALREADY has a skill system at `core/src/skills/` — `registry.ts`,
> `builtin-loader.ts`, **`external-loader.ts`** (user skills), and
> `production-bindings.ts` (skill↔production wiring). There are also 16 genre packs
> at `core/genres/*.md`. So §3 below is NOT a new loader — it's verifying/extending
> the existing external loader and exposing it in the UI.
> Compiled copies ship as `@actalk/quire-core/skills/` (+ `inkos-core` mirrors): interactive-film,
> long/short-market-research, long/short-story-analysis, long/short-writing,
> play-world, script-writing, story-cover, story-deslop, story-import, story-review,
> storyboard, translation.
> Problems found: (a) SKILL.md **frontmatter descriptions are mojibake** — Chinese
> text corrupted by a wrong-encoding write (`description: ���_؆�?...`), body text is
> English; (b) **~92,000 Han-character matches inside `quire-core/dist/*.js`** —
> prompts, role folder names (`roles/主要角色`), UI strings compiled into the engine;
> (c) skills are static — no user skills, no versioning, no connection to the
> style/taste system.

## 1. Fix the Chinese/mojibake (mechanical, do first)

### 1.1 Skill frontmatter
For each of the 30 SKILL.md files (quire-* and inkos-* mirrors):
1. Rewrite `description:` in English (one sentence, derived from the body — the body
   already states the method clearly).
2. Ensure files are UTF-8 (no BOM); add a lint script `scripts/check-skills.mjs`:
   frontmatter parses, `description` is ASCII-safe or valid UTF-8, name matches
   folder. Wire into `test.mjs`.
3. Deduplicate: `inkos-*` mirrors are byte-copies — make quire-* canonical and have
   the inkos-core loader alias to them (or symlink at build), so fixes happen once.

### 1.2 Engine prompts (the 92k Han matches in dist)
These come from TypeScript sources compiled with Chinese prompt/label literals.
Strategy — do NOT sed the dist; fix at source in
`vendor/studio/packages/core/src` (note: `src/prompts/` already exists as a
directory — extend it as the resource home):
1. Inventory: `rg -c "[\p{Han}]" packages/core/src --sort path` → ranked file list.
   Expect clusters in: prompt builders (architect/writer/auditor/reviser), role
   scaffolding (`主要角色/次要角色` → `main-characters/side-characters`), state
   bootstrap templates, error/UI strings.
2. **Prompts** → extract to `quire-core/prompts/<agent>.<lang>.md` resource files
   loaded by key (`prompt("writer.scene", lang)`); author `en` as primary, keep `zh`
   as translation. This also unblocks future language packs and makes prompts
   editable without recompiling — same philosophy as publication definitions.
3. **Folder names** (`roles/主要角色`) → English canonical names + a read-shim that
   also recognizes the old names for existing projects (migration note in
   `migrate` script: rename on first open).
4. **Chapter filename pattern** `<n>_<title>.md` — titles may be Chinese for old
   books; leave data alone, only code-side names change.
5. Acceptance: `rg "[\p{Han}]" quire-core/src` returns only `zh` resource files;
   Studio runs a full book pipeline with zero Chinese surfacing in UI or files;
   the 415-entry runtime translation dict (patch.js) can be deleted (02 kills the UI
   half; this kills the API-string half).

## 2. Upgrade skills to current standard

The bodies are good craft but below the standard of the user's own skill library
(mag-content/mag-design/sbinkos style: explicit workflow, checklists, references/,
few-shot examples, taste-rule accretion). Per-skill upgrade template:

```
skills/<name>/
  SKILL.md            — method (keep), + WHEN-TO-APPLY, + DO/DON'T checklist,
                        + output contract (exact JSON/md shape the executor expects)
  references/         — 2–4 short exemplar excerpts (already exists for long-writing;
                        add for the rest)
  rules.jsonl         — appended by the taste engine (18); loaded newest-first, capped
```

Priority upgrades (highest impact first):
1. **quire-story-deslop** — becomes the `destyle` stage executor prompt (14 §5).
   Merge in the humanizer ruleset (banned patterns: rule-of-three, em-dash chains,
   negative parallelism, AI vocabulary list, uniform sentence rhythm); output
   contract: list of `{para, span, issue, rewrite}` so the UI's Accept-fix works
   (02 §3 findings). Add before/after reference pairs.
2. **quire-story-review** — align output to structured findings with offsets
   (`{para,start,end,category,severity,note,fix?}`) — the audit UI depends on it.
3. **quire-long-writing / short-writing** — add style-pack awareness section ("a
   STYLE block may follow; it wins over genre defaults"), scene-ledger output stub.
4. **quire-story-cover** — extend to full artplan craft (composition, type-safe
   areas, world technique honoring) — feeds design.artplan (14 §6).
5. **NEW `quire-magazine-page`** — the page-bundle authoring method from 13 (content
   + spec + art briefs in one turn); the publication definition's `voiceSkill`
   mechanism already supports pointing at it (types.d.ts §prompts.voiceSkill).
6. **NEW `quire-design-layout`** — the golden rules + break catalogue from 06, as the
   spec-authoring skill.

## 3. User skills + skill loading (extend what exists)

1. Loader: `core/src/skills/external-loader.ts` already loads external skills —
   verify its search path (point it at `workspace/skills/`), and add same-name
   override precedence (user wins over builtin). Validate like §1.1 lint; a broken
   skill is skipped with a doctor warning, never fatal (registry.ts likely does this —
   confirm and test). `production-bindings.ts` is where new skills (magazine-page,
   design-layout) get bound to production stages.
2. Context pack (15 §3) attaches the stage's skill body + top-N rules.jsonl entries.
3. API: `GET /api/v1/skills`, `GET/PUT /api/v1/skills/:id` (edit in UI later);
   Setup screen lists skills with source (builtin/user) and last-modified.
4. Versioning: `version:` in frontmatter; chapter/page sidecars record
   `skills: [{id, version}]` (matches style-pack versioning in 05).

## 4. Tools (registry hardening — companion to 15 §2.1)

1. Every tool: JSON schema, one-line description written for the model, `sideEffects:
   true|false`, `resource: llm|comfy|affinity|fs|net` (queue concurrency, 14 §2.3).
2. Uniform result envelope `{ ok, data?, error?: {code, message, hint} }` — the
   corrective-turn mechanism (15 §2.3) depends on `hint`.
3. MCP tools exposed to the model as `mcp_<server>_<tool>` only when the stage
   allowlist names them; `mcp.mjs` health-ping before first exposure per session.
4. Kill `mcp-server.mjs` bypass path checks stay (harness-live test 3 already guards).

## 5. Order

| # | Task | Gate |
|---|---|---|
| 1 | Frontmatter fixes + skills lint + dedupe mirrors | lint green in test.mjs |
| 2 | Prompt inventory + extraction to resource files (top 10 files by Han count) | book pipeline runs, no Chinese in outputs |
| 3 | Role-folder rename + read-shim + migration | old + new projects both open |
| 4 | deslop + review upgrades (structured outputs) | audit UI Accept-fix works end-to-end |
| 5 | User-skill loader + skills API | user skill overrides builtin in a run |
| 6 | writing/cover/new-skill upgrades | magazine page-bundle turn uses quire-magazine-page |
| 7 | Tool envelope + allowlists | harness-live extended tests green |
