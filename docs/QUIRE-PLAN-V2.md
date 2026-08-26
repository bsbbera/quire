# Quire Plan v2

Supersedes the phase list in QUIRE-PLAN.md, which had drifted out of date —
several phases it left unmarked were in fact built. Written against the source.
Each item states what was there, what was missing, and what "done" means as
something checkable.

Status is recorded per item. Where the plan turned out to be wrong about what
existed, that is recorded too, rather than quietly dropped.

---

## P1 — Quire's MCP is Quire's own — **done**

**Was.** `cli-shim/mcp.mjs` scanned `Claude Extensions` and
`claude_desktop_config.json` at runtime and listed what it found. Quire's own
config, `~/.inkos/mcp.json`, was empty. Every non-bundled server was borrowed
live from another app: edit that app's config and Quire's capabilities changed
underneath it, with nothing in Quire recording what it was supposed to have.

**Now.** Discovery runs once, at first run, and copies what it finds into
`~/.inkos/mcp.json` — command, args, cwd and env, API keys included, so nothing
needs reconnecting. After that the file is the only source and Quire spawns its
servers from its own configuration. The MCP page tags each server `bundled` or
`imported`; `source` still records where it originally came from, as history
rather than as a live dependency.

**Key safety.** The file holds live credentials. It sits under the user's home,
`.inkos/` is gitignored, and `cli-shim/mcp-config.test.mjs` fails if it is ever
tracked. That test also proves the import happens once: it removes the
discovered config and checks the server is still there.

**Verified in the app.** 13 servers imported, 3 carrying credentials, `quire`
still bundled.

**Known consequence, not yet addressed.** Importing everything means importing
*everything* — the chat tool table now runs to roughly 200 tools, most of them
Blender and PowerPoint. They are Quire's own entries now, so they can be
switched off from the MCP page, which is the point of the change. Whether they
should be imported disabled by default is a separate decision.

---

## P2 — The rule stack reaches every pipeline — **done**

**Was.** `buildWritingMethodologySection()` was imported by exactly two files,
both on the long-book path. `short-fiction-runner.ts` injected no methodology
at all — it had a hand-maintained craft list of its own in
`prompts/short-fiction.ts`. The publication pipeline had nothing:
`publication-voice.ts` scraped craft-named headings out of a voice skill and
that was all. The 25 universal rules were not universal; they applied to books.

**Now.** The methodology is split into the two things it was holding. The
anti-AI material is about prose — emotion carried by action, transitions that
do not read as connective tissue, factual consistency, borrowed vocabulary —
and is as true of a two-page explainer as of a novel chapter. The rest is
narrative craft.

`utils/rule-stack.ts` assembles the layers and is the only thing composing
them:

| Layer | Source | Applies to |
|---|---|---|
| Universal | `writing-methodology.ts` prose half | every kind |
| Story | `writing-methodology.ts` narrative half | book, short, script, storyboard |
| Genre | resolved by the caller | story kinds |
| Own | rule files on disk, per kind | all |

A magazine takes the universal layer and not six-step character psychology,
which has nothing to say about monsoon farming.

**Publications gained the canon they were missing.** A book carries
`book_rules.md` and `story_bible.md` across chapters; a series had nowhere to
put the equivalent, so house prohibitions and register were re-derived each
issue. `series_rules.md` and `house_style.md` now live beside the issues and
are read the same way. `current_focus.md` is read last everywhere, so near-term
steering beats standing law.

The factual-consistency and language-constraint rules the universal layer was
described as having, and did not, were written.

**Done.** A rule added to the universal layer reaches the next magazine page
and the next short chapter with no per-pipeline edit. `rule-stack.test.ts`
pins it.

---

## P3 — Audit and de-AI reachable for everything — **done**

**Publications: the plan was wrong.** Both passes existed and were wired, and
`PublicationDetail.tsx` already renders "Audit & revise" and "De-AI pass" over
a six-stage bar. The sidebar routes to it. What made it unreachable was that
the sidebar section is hidden when there are no publications — and this
workspace has none, because the magazine runs went through a personal
`mag-content` skill instead of `publication_create`, so nothing was ever
written to the store. The section now renders when empty and says so. The
routing problem behind it is separate and still open.

**Stories: genuinely missing.** No audit tool and no deslop tool existed for
short fiction, scripts or storyboards. The short-fiction runner reviews its own
draft once, mid-run, and after that the file was final.

**Now.** `pipeline/story-audit.ts` adds the story-side equivalents: 30
dimensions answerable from the text, plus the rule pass already shared with the
publication audit. Both work on a file rather than a project, so they reach
anything the pipelines wrote, including work written before they existed. The
audit rewrites what it faults and re-checks, bounded at two rounds, keeping the
text as it stood beside the file. `story_deslop` is the same loop with only the
machine-made findings acted on — a plot hole is reported and left alone.

Available in every session kind that produces an artifact, and deliberately not
behind a confirmed intent: an audit is what you ask for *after* a run.

**On the three different dimension counts.** The publication audit is 31
model-judged plus 6 rule-based. The chapter pipeline's are continuity
dimensions needing book state. The story audit's 30 are the ones answerable
from a finished file. Three sets, three jobs — they should stay separate and
be labelled separately.

**Verified in the app.** `story_audit` and `story_deslop` are in the live tool
table.

---

## P4 — View, edit, save on every artifact type — **done**

**Was.** `ToolExecutionSteps.tsx` recognised five artifact kinds and drew rows
for three. Short fiction, covers and every publication wrote files the chat
named and offered no way to open.

**Now.** Rows come off the result's own `kind` rather than a second list of
tool names — a list that was already out of step, which is why publications
rendered nothing. Short fiction gains rows for the story, the synopsis and
selling points, and the cover prompt. Publications gain one row per written
page; `publication-runner` derives page paths rather than storing them, so this
works for issues written before it existed. The drawer they open already reads,
edits and saves.

---

## P5 — ComfyUI and Affinity — **done, with one item resolved differently**

**The plan was wrong about how much was missing.** `comfy_generate` existed and
was wired to the shim. `publication_art`, `publication_layout`,
`publication_render` and `publication_build` existed. The shim answered
`/affinity/build`, `/affinity/page`, `/affinity/render` and `/affinity/status`.
Per-page resume existed. The art stage was already gated on approval.

**5a — reach. Resolved differently, on purpose.** The plan said to add
`comfy_generate` to the short and storyboard sessions. Doing that would have
put an ungated image tool in reach of the model, against the rule that art asks
first. The real gap was narrower and worse: a storyboard writes image prompts
and an `assets.json` modelling every shot, and *nothing ever rendered them*.
`storyboard_art` does, behind a confirmed intent like `generate_cover`, and
resumably — a shot already generated is skipped, a failed one is retried, and
the manifest is saved after every image, so a run that dies at nineteen keeps
eighteen.

**5b/5c — preflight. Done.** A run reached the art stage and discovered ComfyUI
was installed but not running, which surfaced as `art p1: fetch failed` after
the research, planning, writing and audit had been spent. It is the one failure
the app can fix by itself and it was reported as if page one were at fault.
`utils/renderer-preflight.ts` asks the shim, starts ComfyUI if it is only
asleep, and says plainly what is wrong if it is not. Affinity gets the same
check before build, layout and render; it cannot be started for the user, but
refusing before staging assets beats producing a document with holes in it.

**5d — scoped mutation. Done.** A page was the smallest thing anything could
touch, so a note about one sidebar put the whole page through the revise pass
and came back with a different body too. `publication_element` takes an address
(`page:16/furniture:2`, `page:16/deck`, `page:16/brief`) and a verb, `update`
or `delete`. Addresses are a page number and an element name because those
survive a rewrite, which an offset would not. Body and title refuse deletion.

**5e — feedback loop. Done.** `publication_render` returned a path, which made
it a tool that proved a file existed; the model then designed the next revision
against its own idea of the page rather than against the page. Tool results
carry images, so it now returns the image.

**5f — art gate. Was already there.** `requireApproval(issue, "art")`.

---

## Still open

- **Magazine routing.** Runs go through the personal `mag-content` skill rather
  than `publication_create`, so nothing lands in the publication store — which
  is what made the audit UI unreachable. Root cause not yet isolated.
- **Imported MCP volume.** ~200 tools in the chat table after the import. They
  can be switched off per server now; whether they should arrive disabled is
  undecided.
- **`comfy_generate` in chat is ungated.** It has always been, and it is not
  what the short and storyboard art paths use. Worth revisiting alongside any
  general tool-confirmation gate.
