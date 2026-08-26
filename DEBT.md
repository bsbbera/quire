# Quire — Debt

Everything skipped, stubbed, unverified, or knowingly left worse than it should be.

Rules for this file:

- An item goes in **when it is created**, not when someone remembers it.
- Each item says what is wrong, what it costs, and what closing it takes.
- Nothing is removed on a guess. An item is deleted only when the fix has run in
  the app.
- "Works on my terminal" is not closure. See `verify-in-app-not-terminal`.

Status key: **OPEN** · **VERIFY** (built, never proven in the app) · **CLOSED** (proven, kept briefly for the record)

---

## Unverified against real hardware or real apps

### D1 — `renderPage` PNG export is unverified against Affinity — **VERIFY**
*Created: Phase 3.*
`cli-shim/affinity.mjs`'s `renderPage()` exports one spread via `_doc.export()` with
`FileExportOptions.createWithPresetName("PNG")` and `opts.spreadIndex = page - 1`.
Affinity was not running when it was written, so the SDK call shape was never
checked against a live document. It fails soft (`{ok:false, error}`), so a wrong
call looks like "could not render", not a crash.

**Cost:** the page-preview button in the new publication detail page may never
produce an image, and the failure will look like a missing file rather than a
wrong API call.
**To close:** open Affinity with a built issue, click *Render spread* on the
detail page, confirm a PNG appears at the path returned.

### D2 — `codex` CLI has no `--strict-mcp-config` equivalent — **OPEN**
*Created: Phase 1.*
`claude` gets `--strict-mcp-config`, which guarantees it ignores its own MCP
config and uses only what Quire hands it. `codex` has no such flag, so a codex
run can still reach servers configured in the user's own codex config —
channel 2 of the three tool channels Phase 1 was meant to collapse.

**Cost:** on codex specifically, the "one gated channel" guarantee is a
best-effort, not a guarantee. Every other adapter holds.
**To close:** either find the equivalent flag, or launch codex with a
`CODEX_HOME` pointed at a Quire-owned empty config directory.

---

## Built but never exercised end to end

### D3 — The model half of the audit — **CLOSED**
*Created: Phase 5. Closed: 2026-08-26, live run against the shipped magazine.*

Two questions were open: whether models return usable `dimension` numbers, and
whether findings are specific enough to revise from. Both answered.

First attempt failed on all 12 pages with `ENOENT` on
`.inkos/sessions/publication:<issue>:audit-1.jsonl` — `publicationSessionId`
put colons in the id, and a session id becomes a filename. A colon in a Windows
path is the NTFS alternate-data-stream separator. **Every publication stage —
plan, every page, design — had been failing to persist its transcript on this
platform since Phase 2**; it was invisible because no earlier stage read the
transcript back. Fixed (`--` separator, everything outside `[A-Za-z0-9._-]`
folded down).

Second run: **46 findings across 12 pages, no page unread.**

| Cluster | Count |
|---|---|
| Sourcing and accuracy (dim 6, 7, 8, 9) | 20 |
| Furniture (dim 22, 23) | 11 |
| Rule pass (ai-tell, length) | 8 |
| Structural (dim 16, 26, 27) | 6 |
| Abstraction (dim 13) | 1 |

Findings are specific, checkable, and quote the offending text. Real defects in
the printed issue, including: a typeface dated to 1925 called "four years before
the word photography settled into common English" (it was coined in 1839); a
stat box asserting a modern phone makes Sasson's image "12,000 times over" when
the arithmetic gives 1,200; Kodak's suppression called twenty-six years when
patent-to-disclosure is twenty-three; and an analogy that inverts how bitumen of
Judea actually behaves.

**Still open:** whether the *revise* half converges. This run used
`revise: false` — the model chose that itself from a "report only" instruction,
which is its own small proof that the parameter works. Nothing yet knows whether
two rounds fix these or thrash. That is D15.

### D15 — The revise loop deleted content on its first live run — **FIXED, needs re-proof**
*Created: Phase 5. Failure found 2026-08-26, live, on the shipped magazine.*

Ran `publication_audit` with `revise: true`. The loop converged as designed:
**46 findings → 28, two rounds**, stopping at the round budget. Real errors were
genuinely fixed — the false "1925, four years before the word photography
settled into common English" is gone, replaced with the correct 1839 Herschel
attribution.

It also **destroyed 27 of 36 furniture blocks.** Every one of the twelve revised
pages lost boxes; four pages lost all of them. Cause: `revisePage` did
`out.furniture ? keepAllowedBlocks(...) : page.furniture`. An empty array is
truthy, and a model that omits the unchanged boxes — or returns them in a shape
`keepAllowedBlocks` rejects — silently wiped the page. Restored from backup.

Two fixes: the runner now keeps the old blocks unless the revise returns usable
ones, and emits a warning when it has to; and the revise prompt now says to
return the furniture in full, including the blocks it did not change.

**Also observed, not yet fixed:**
- `dim2/Premise delivery` went 0 → 3. The revise *dropped* content the plan
  called for: p13 lost Gerwig from a named trio, p14 lost "the processing
  machine sold for scrap". The prompt fix above addresses this too, unproven.
- `dim9/Attribution` went 4 → 0, but p10's "hid it in a drawer for twenty-six
  years" is **verbatim unchanged** and still wrong (patent 1978, disclosure
  2001 = twenty-three). The finding stopped being reported without the error
  being fixed. See D16.

**To close:** re-run with `revise: true` on a backup copy and confirm no page
loses a block or a premise element.

### D16 — A finding disappearing is not evidence it was fixed — **OPEN**
*Created: 2026-08-26, from the D15 run.*
The model audit is non-deterministic. Across two rounds, `dim9` findings went
4 → 0 while at least one of the errors they described survived untouched in the
copy. So the headline number — "46 → 28" — overstates what was actually
repaired, and a category reaching zero means nothing on its own.

**Cost:** the convergence metric is not trustworthy as a quality measure, which
is exactly what someone will read it as.
**To close:** carry finding identity across rounds (page + dimension + a hash of
the quoted text) so a residual finding is distinguishable from a forgotten one,
and report "fixed / still present / no longer reported" rather than a count.

### D14 — The sidebar and the detail page counted "written" differently — **CLOSED**
*Created: Phase 6. Closed: Phase 7, verified on screen.*
Two predicates: `listIssues` counted a body that existed, `stageStates` counted
one with non-whitespace in it, and the shipped magazine read `16/16` in the
sidebar and `12/16` on its own detail page. Existence was the right test — a
plate page is written when it has an empty body, because an empty body is what
a plate is. Both now call `isPageWritten`. Both read `16/16` on screen, and the
API agrees for both issues in the workspace.

### D4 — Resume, approve and feedback routes are untested against a running server — **VERIFY**
*Created: Phase 6.*
`gateState` and `stageStates` are unit-tested. The five routes around them
(`GET /:id`, `approve`, `resume`, `audit`, `render`, `feedback`) have no tests
at all — they are thin, but "thin" is how a wrong `c.req.param` ships.

**Cost:** a broken route shows up as a dead button.
**To close:** click each control in the detail page against a real issue.

---

## Deliberately narrower than it looks

### D5 — "37 dimensions" is 31 + 6, not the chapter pipeline's 37 — **OPEN**
*Created: Phase 5.*
InkOS's `ContinuityAuditor` runs 37 story dimensions (OOC, timeline, hook debt,
POV, arc flatline…). Almost none transfer to a magazine page. What publications
now have is **31 editorial dimensions judged by the model**
(`publication-review.ts`) **plus 6 rule-based ones** (`publication-audit.ts`:
word band, paragraph uniformity, hedge density, formulaic transitions,
list-shaped prose, cross-page repetition). Thirty-seven total, by arithmetic,
not by inheritance.

**Cost:** none technically. It is here so nobody later claims publications run
"the same 37-dimension audit as chapters" — they do not, and should not.
**To close:** nothing to fix. Delete when the docs stop implying otherwise.

### D6 — The revise loop cannot fix a structural finding — **OPEN**
*Created: Phase 5.*
`revisePage` rewrites **one page in place**, and is explicitly forbidden from
adding facts not already in the page or the research. So a finding like
"dimension 27: this contradicts p12" or "dimension 2: this page does not deliver
its planned premise" can be reported but not really fixed — the honest fix is a
re-plan or a re-research, which the loop will not do.

**Cost:** structural findings survive every round and end up in the residual
list, which can read like the loop failing when it is refusing.
**To close:** route structural findings to a plan-level revise instead of a
page-level one, or mark them as not-auto-fixable in the UI so the residue is
legible.

### D7 — De-AI-ification is a filter over the same loop, not a rewriting style — **OPEN**
*Created: Phase 5.*
`runDeslop` is `runAudit` with `only: isSlopFinding`. It rewrites pages the audit
already faulted on prose grounds. It does **not** do what a dedicated de-slop
pass would: rewrite prose that no dimension flagged but that still reads as
machine-made.

**Cost:** a page that is uniformly, unremarkably AI-shaped without tripping any
individual threshold passes clean.
**To close:** a voice-rewrite stage that runs regardless of findings, if the
filtered version proves insufficient in practice.

### D8 — Feedback on a *section* is not implemented; only per-page and per-issue — **OPEN**
*Created: Phase 6.*
The plan's Phase 6.5 asked for feedback on "a page or section". The detail page
does per-page notes (which become findings and go through the revise loop) and
per-issue notes (stored, read by later stages). A note scoped to a section has
no control.

**Cost:** "fix the tone across section 2" means clicking four pages.
**To close:** a section-level control that fans out to its page range.

### D9 — Approval has no identity behind it — **OPEN**
*Created: Phase 6.*
`approve()` records `{at, by}` and `by` is whatever the runner defaults to.
Quire has no user accounts, so a sign-off is "someone at this machine, at this
time".

**Cost:** fine for a single-user desktop app; a lie the moment two people share
a workspace.
**To close:** nothing until Quire is multi-user. Noted so the field is not
mistaken for an audit trail.

---

## Phase 7 — memory, state parity, durability

### D10 — Phase 7: memory, state parity, schema validation — **CLOSED**
*Closed: Phase 7. See D17 for what is built but not yet proven in a live run.*

All four are built. What each turned out to mean:

1. **Memory.** Publications now index themselves per issue —
   `publication-memory.ts`, over `LocalSearchIndex`, the same BM25 kernel book
   memory retrieves through. What did **not** transfer is `MemoryDB`'s temporal
   layer: it tracks a fact's validity across chapters because a character's
   state changes, and page 13 does not invalidate what page 12 established. So
   publications get the retrieval half and not the temporal half, deliberately.
2. **Retrieval into context.** Two places had been faking recall by truncation —
   the writer got 140 characters of every page already written, the auditor got
   200. Above twelve written pages both now get the pages that actually bear on
   this one. Below it, the complete list is still better than any ranking of it.
   The research half is the larger win: `pageResearch`'s fallback used to be
   "the first four findings of every pillar", which ignores what the page is
   about.
3. **Schema validation.** `publication.json` is checked on read and before every
   write. The line took two tries to find — see the file's own comment. Both
   earlier attempts refused a real issue in the workspace, so what is required
   is now the spine only: an id, a list of sections, a list of pages, and a page
   number that is a number.
4. **Atomic writes.** `save()` writes a sibling and renames over the target.
   A crash or a full disk can no longer leave half a JSON file where the issue
   was.

### D17 — Recall has never fed a live model run — **VERIFY**
*Created: Phase 7.*
The index was built against both real issues in the workspace and returns the
right things: for the film issue's timeline page it recalls the Brownie, the
Polaroid and Ektachrome, which is exactly what that page is about. But that was
a query, not a run. No page has yet been *written* or *audited* with recalled
context in the prompt, so what is proven is that recall retrieves well, not that
the pages come out better for it.

**Cost:** the claim "publications have memory" is currently true of the storage
and false of the writing.
**To close:** write or audit one page of a >12-page issue and read the prompt
that went out.

### D18 — One audit POST fired that nothing explains — **OPEN**
*Created: Phase 7.*
While the detail page was open, a `POST /publications/:id/audit` appears in the
network log that no click produced. It failed (the server was stopping) and has
not recurred across three page loads since.

**Cost:** if it is real and not a browser artefact, a page load can start a paid
model run.
**To close:** watch for a second one. If it recurs, the audit button or an
effect in `PublicationDetail.tsx` is firing without a click.

### D19 — Older research has no citations to check against — **OPEN**
*Created: Phase 7.*
Both issues in the workspace store research the old way: `{origin: [{fact, who,
when, why_it_matters}]}`, with no URLs. The index reads that shape now (it read
only the current one at first, which would have left the only real data with no
research at all), but it can only offer *who* and *when* as the source. Audit
dimensions 6, 7 and 9 are checking attribution against a name and a date rather
than a citation.

**Cost:** on old issues, "is this claim sourced?" is a weaker question than the
dimension intends.
**To close:** nothing automatic. A re-research would fix one issue at the cost
of rewriting it.

---

## Not started

### D11 — Phase 8: the full end-to-end suite has never been run — **OPEN**
Six scenarios in the plan (full run with zero manual steps; gate denied at
build; ComfyUI down; scoped page feedback; full teardown and rebuild; the same
suite on a second publication type). None run. Until 8.6 passes, "the loop is
generic" is a design intent, not a demonstrated fact.

---

## Environment (not ours, but they hide real failures)

### D12 — Two core tests failed on Windows without admin — **CLOSED**
*Closed: Phase 7.* `symlink()` needs elevated privileges on Windows and both
tests are about what the registry does with a symlink, not about whether the OS
will make one. They now skip on `EPERM`. The core suite is 1948/1948 — the first
run with nothing red in it, which is the point: two permanent failures teach
everyone to read a red run as green.

### D13 — One studio test asserted the pre-rebrand name — **CLOSED**
*Closed: Phase 7.* `src/api/server.test.ts` expected `"InkOS 内部流程错误"`; the
code says `"Quire"`. Assertion updated. Studio is 590/590.
