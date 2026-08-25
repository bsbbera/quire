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

### D15 — The revise half has never run against a real model — **VERIFY**
*Created: Phase 5.*
`revisePage` is covered by tests with a scripted `ask`, and the live audit above
deliberately ran with `revise: false`. So nothing is known about whether a real
revise round actually clears its findings, holds the word band, or drifts the
voice — and D6 predicts structural findings will survive every round by design.

**Cost:** "the audit fixes what it finds" is proven as a loop, not as an outcome.
**To close:** run `publication_audit` with `revise: true` on the shipped
magazine, diff the copy, count findings before and after.

### D14 — The sidebar and the detail page count "written" differently — **OPEN**
*Created: Phase 6.*
`listIssues` counts a page written when `body !== null && body !== undefined`, so
an empty string counts. `stageStates` counts it written when the body has
non-whitespace in it. The shipped magazine therefore reads `16/16` in the
sidebar and `12/16 pages written` on its own detail page.

**Cost:** small but corrosive — the two numbers are on screen together.
**To close:** one predicate, used by both.

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

## Not started

### D10 — Phase 7: memory, state parity, schema validation — **OPEN**
Four items, none begun:
1. `memory.db` is book-scoped; publications get no memory, so every page is
   written cold with no recall of what earlier pages established.
2. No retrieval into publication context.
3. `publication.json` has **no schema validation**. Definitions are validated;
   issues are not. Tools now mutate issues on several paths, and a malformed
   write is caught by nothing.
4. Writes are not atomic. `save()` is a plain `writeFile`; a crash mid-write
   truncates the issue.

**Cost:** (3) and (4) are the sharp ones — an interrupted `build` or a bad tool
write can destroy an issue with no recovery.

### D11 — Phase 8: the full end-to-end suite has never been run — **OPEN**
Six scenarios in the plan (full run with zero manual steps; gate denied at
build; ComfyUI down; scoped page feedback; full teardown and rebuild; the same
suite on a second publication type). None run. Until 8.6 passes, "the loop is
generic" is a design intent, not a demonstrated fact.

---

## Environment (not ours, but they hide real failures)

### D12 — Two core tests fail on Windows without admin — **OPEN**
`src/__tests__/skill-agent-tool.test.ts` calls `symlink()`, which needs elevated
privileges on Windows. Both failures are `EPERM`, not logic.
**Cost:** a green run is 1932/1934, so a real new failure is easy to miss in the
noise. **To close:** skip the symlink tests when `symlink()` throws EPERM.

### D13 — One studio test asserts the pre-rebrand name — **OPEN**
`src/api/server.test.ts` expects `"InkOS 内部流程错误"`; the code now says
`"Quire 内部流程错误"`. Predates this work.
**To close:** update the assertion.
