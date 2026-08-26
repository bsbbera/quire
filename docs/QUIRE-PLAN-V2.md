# Quire Plan v2

Supersedes the phase list in QUIRE-PLAN.md, which drifted out of date. Written
against the source, not against the old plan. Each item states what exists
today, what is missing, and what "done" means as something checkable.

---

## P1 — Quire's MCP is Quire's own

**Today.** `cli-shim/mcp.mjs` scans `AppData\Roaming\Claude\Claude Extensions`
and `claude_desktop_config.json` at runtime and lists what it finds, tagged
`source: "claude-extension"`. Quire's own config, `.inkos/mcp.json`, is empty.
Every non-bundled server the app uses is therefore borrowed live from Claude
Desktop: if that app changes its config, Quire's tools change under it.

**Missing.** Ownership. Quire reads another program's configuration every boot
instead of holding its own.

**Do.** One-time import, then independence.

1. On first run, if `.inkos/mcp.json` has no servers, copy the discovered
   entries into it verbatim — `command`, `args`, `env` including API keys — so
   nothing needs reconnecting.
2. After that import, stop scanning. `.inkos/mcp.json` is the only source.
   Quire spawns its own server processes from its own config.
3. The MCP page shows two groups: `bundled` (ships with Quire) and `imported`
   (copied once from Claude Desktop, now yours, editable in place).

**Key safety, non-negotiable.** `.inkos/` holds live API keys after this
change. Confirm it is gitignored, and add a test that fails if
`.inkos/mcp.json` is ever tracked. Keys are copied on disk, never committed.

**Done when.** Claude Desktop can be uninstalled and every Quire MCP tool still
works.

---

## P2 — The rule stack reaches every pipeline

**Today.** `buildWritingMethodologySection()` is imported by exactly two files:
`pipeline/runner.ts` and `state/manager.ts`. Both are the long-book path.
`short-fiction-runner.ts` injects no methodology, no craft card, no deslop
guidance. The publication pipeline injects none either — `publication-voice.ts`
extracts craft-named headings out of a voice skill and nothing more.

So the 25 universal rules are not universal. They apply to books.

**Missing.** One rule stack, assembled once, consumed by all four producers.

**Do.** Extract `buildRuleStack({ kind, genre, projectRoot, language })`
returning the layers in order:

| Layer | Source | Applies to |
|---|---|---|
| Universal | `writing-methodology.ts` | every kind |
| Genre | genre rule files | story kinds; publication uses subject rules |
| Project | `book_rules.md`, `story_bible.md`, `author_intent.md` | books |
| Series | **new** `series_rules.md`, `house_style.md` | publications |
| Focus | `current_focus.md` | all |

Then inject it in `short-fiction-runner.ts`, the publication write stage, and
the script/storyboard runners.

**What the magazine takes and what it does not.** A magazine is not a novel and
should not pretend to be. It takes the universal layer that is about prose
quality regardless of form — de-AI-ification, emotion externalised through
action, logical consistency, language constraints. It does not take the
story-structure layer: six-step character psychology does not apply to a
two-page explainer on monsoon farming.

The publication's own persistent canon is the missing half. A book carries
`book_rules.md` and `story_bible.md` across chapters; a magazine series
currently carries nothing across issues. `series_rules.md` (house prohibitions,
reading level, numerical caps) and `house_style.md` (voice, palette, typographic
register) give a series the same memory a book has.

**Done when.** A deslop rule added to the universal layer changes the next
magazine page and the next short chapter, provably by diff, with no per-pipeline
edit.

---

## P3 — Audit and de-AI reachable from the UI, for everything

**Today, publications.** Both passes exist and both are wired:
`publication_audit` and `publication_deslop` (agent-tools.ts:2479, 2498),
backed by `publication-audit.ts` and `publication-review.ts`. The UI exists
too — `PublicationDetail.tsx` renders an "Audit & revise" button, a "De-AI pass"
button, findings, and a six-stage bar with `stopAt`. It is unreachable: the
only reference to the component is `App.tsx:357`, and nothing links there.

**Today, stories.** No audit tool and no deslop tool exist for short fiction,
scripts, or storyboards. `skills/inkos-story-deslop/SKILL.md` is guidance folded
into writing, not a pass you can run afterwards. There is nothing to surface.

**Do.**

1. Give publications an entry point. Not in My Works — that stays exactly as
   it is. A Publications list of its own, reachable from the sidebar, each row
   opening the detail page that already works.
2. Add `story_audit` and `story_deslop` as real tools over the short/script/
   storyboard artifacts, running the story dimensions and the deslop skill as
   a post-hoc pass.
3. Put the same two buttons on the story artifact view.
4. Both passes run against finished output and never re-run the pipeline that
   produced it.

**On the two different 37s.** The publication audit is 31 model-judged
dimensions plus 6 rule-based. The story pipeline's 37 are different dimensions,
because they are story dimensions. Keep them separate and label them separately
in the UI — one number covering two unrelated things is how this got confusing.

**Done when.** Content is generated, then audited, then de-AI-ed, by clicking,
from the app, for a magazine and for a short story.

---

## P4 — View, edit, save on every artifact type

**Today.** `ToolExecutionSteps.tsx` has `getGeneratedArtifactDetails()`
recognising five kinds — `short_fiction_created`, `cover_generated`,
`script_created`, `storyboard_created`, `interactive_film_created` — but
`ScriptStoryboardResultPreview`, the component that actually draws clickable
rows, early-returns unless the tool is one of `script_create`,
`storyboard_create`, `interactive_film_create`. Short fiction and every
publication kind produce files and offer no way to open them.

**Do.** Delete the whitelist. Drive the rows off the artifact kind that
`getGeneratedArtifactDetails()` already returns, so every kind renders. Each
row opens a viewer with edit and save writing back to the file on disk.

**Done when.** Every produced artifact — short, cover, script, storyboard,
film, magazine page — opens, edits, and saves from the run that made it.

---

## P5 — ComfyUI and Affinity: finish what is already standing

Correcting the record: this is not unbuilt. `comfy_generate` exists and is
wired to the shim. `publication_art`, `publication_layout`, `publication_render`
and `publication_build` exist. The shim answers `/affinity/build`,
`/affinity/page` and `/affinity/render`. Per-page resume exists —
`publication-runner.ts:1117`, "a stopped run resumes exactly where it left off",
with `from`, `stopAt` and `redo`. What is missing is narrower than the old plan
implies.

**5a — Reach.** `comfy_generate` is available in `chat` and `publication`
sessions only. A `short` or `storyboard` session cannot generate a cover or a
shot frame without leaving the session. Wire the image tool into those kinds
behind the same confirm gate.

**5b — Preflight, ComfyUI.** `GET /comfy/status` currently reports
`up: false, installed: true` and nothing acts on it, so an art stage discovers
the renderer is down after the run has already spent its writing. Check status
before the art stage; offer `/comfy/start`; show the state in the UI before the
user commits.

**5c — Preflight, Affinity.** No `/affinity/status` exists at all. Add one,
same treatment.

**5d — Scoped mutation.** `publication_layout` already does one page without
rebuilding the issue — that is `update` at page scope, and it works. Missing:
element-level addresses (`page:16/section:1`) and a `delete` verb. Add both, so
a change to one section touches one section.

**5e — Feedback loop.** `publication_render` returns a picture of a spread and
that picture does not re-enter the conversation. Feed it back as a turn so the
model sees what Affinity actually produced and can revise against it, rather
than designing blind and one-shot.

**5f — Approval before art.** Short fiction now stops at the cover prompt and
waits for `generate_cover`. The publication art stage still runs without asking.
Same gate: audit, then approval, then pixels.

**Done when.** Feedback on one section changes that section's files and nothing
else, provably by diff; and a stopped art run resumes instead of regenerating
finished images.

---

## Order

1. **P1** — small, self-contained, and it stops Quire depending on another
   app's config while everything else is being changed.
2. **P5b/5c** — preflight, so nothing below wastes a run discovering a dead
   renderer.
3. **P2** — the rule stack, because audit and deslop are worth more once every
   pipeline is held to the same rules.
4. **P3** — audit and de-AI surfaced.
5. **P4** — view/edit/save everywhere.
6. **P5a/5d/5e/5f** — reach, scoped verbs, feedback loop, art gate.
