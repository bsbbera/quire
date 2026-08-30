# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

The maker, plus a small number of writers they know personally and hand the
build to directly. Nobody discovers Quire on their own, and there is no support
channel, so the design has to be self-explaining without becoming a tutorial:
a first run that works, failures that say what to do, and no marketing surface.

The session is long. A normal day is hours inside the same window, alternating
between reading a draft, judging it, and directing the next one. Comfort over
hours outranks first-impression impact.

## Product Purpose

One desk for producing a finished publication end to end: research it, write it,
audit and revise it, make the artwork, and lay out the pages, without leaving
the app or hand-carrying files between four tools.

Two jobs sit on that desk in roughly equal measure:

1. **Long-form writing.** Books and serials, chapter by chapter, through a
   draft / audit / revise loop.
2. **Illustrated magazine issues.** A staged production run: subject, flatplan,
   per-page copy, ComfyUI artwork, Affinity layout.

Neither is the secondary case. The interface has to hold a quiet multi-hour
reading and editing session and a multi-stage production run with gates, and
favour neither.

## Positioning

Quire ships no model and holds no credentials. The shim finds the agent CLIs
already installed and signed in on the machine (Claude Code, Codex, Devin,
Antigravity) and exposes every model they offer through one local
OpenAI-compatible endpoint. MCP servers are read from where Claude Desktop,
Claude Code, Codex and Devin already declare them, rather than being declared a
second time.

A competitor can copy the pipeline. It cannot copy running entirely on
subscriptions the user already pays for, with nothing to sign up for.

## Operating Context

- Desktop app: a Tauri shell over a model shim and a workbench (a fork of InkOS
  Studio, vendored at `vendor/studio`, staged into `cli-shim/engine`).
- The workspace is a real folder of real books on disk (`~/Quire`, or a
  pre-existing `~/InkDesk`), not a database. Files are the source of truth.
- Work runs in stages that report progress over SSE while the user is doing
  something else, and often while they are looking at another window entirely.
- External machinery the app drives: provider CLIs, ComfyUI for artwork,
  Affinity for layout, MCP servers for tools.
- Releases move through three installs: a dev build, an intermediate backup
  build, and the live build that updates itself.

## Capabilities and Constraints

Confirmed and binding, each verified in the code:

- **No credentials of its own.** No API key field exists anywhere, and none may
  be added. Provider failure is resolved by installing or signing into a CLI.
  The launcher states this in its own copy: "No API key, works offline."
- **Local and offline.** Every runtime call is to `127.0.0.1`. There is no
  cloud account, no telemetry, no remote runtime dependency. Nothing in the
  interface may imply a network round trip that does not exist, and no asset
  (font, icon, image) may load from a CDN.
- **InkOS attribution is permanent.** Quire runs a fork of InkOS Studio under
  AGPL-3.0. The notice occupies real, visible sidebar space and may not be
  relocated into an About dialog or hidden to tidy a layout.
- **Windows is the target.** The release workflow builds `windows-latest` only.
  Chrome, scrollbars and keyboard hints follow Windows convention. macOS is not
  currently built.
- **Two languages.** The vendored workbench carries roughly 2,700 Chinese string
  literals; a runtime patch translates the ones outside the i18n table. Any text
  work has to survive both languages, and the translation layer is being retired
  rather than extended.

Undecided, and not to be invented: licensing, pricing, distribution beyond
direct hand-off, and whether macOS is ever supported.

## Brand Commitments

- **The name.** A quire is the gathering of folded sheets that makes one
  signature of a book. The product is named after a unit of bookmaking, and the
  identity should stay inside that world rather than software abstraction.
- **Geist** is the pinned interface typeface, chosen deliberately and confirmed
  when a saturated-pattern warning was raised against it.
- The existing mark is the three nested arcs used in the launcher and sidebar.
- **InkOS Studio** attribution, as above. It is a legal commitment, not a
  courtesy.

## Evidence on Hand

- `README.md`: the product's own account of the shim, MCP discovery and the
  build pipeline.
- A working app at 0.1.22 with real books in the workspace.
- Reference images the user supplied for visual direction, held in the
  conversation rather than the repo.

There are no customers, testimonials, benchmarks, press, pricing or usage
numbers. None may be fabricated in any surface.

## Product Principles

1. **Files on disk are the truth.** The interface is a view onto a real folder.
   Nothing may imply state that does not exist as a file.
2. **The machine's settings and the book's settings are different things.**
   Providers, ComfyUI and integrations belong to the computer. Models, style and
   language belong to the project. Mixing them produced two disagreeing model
   pickers once already.
3. **Long sessions beat first impressions.** This is a tool someone sits inside
   for hours. Anything that impresses on the first screen and tires on the
   fourth hour is a bad trade.
4. **Work happens while nobody is watching.** Runs are long and the user is
   often elsewhere. Progress, completion and failure have to be legible on
   return, not only in the moment.
5. **Borrowed, and honest about it.** The workbench is someone else's software
   under a copyleft licence. The design says so plainly.

## Accessibility & Inclusion

No formal standard has been set. One product-specific need is established: the
primary use is reading and editing prose for hours, so text comfort (measure,
leading, contrast, and the absence of ambient motion near the reading column) is
a functional requirement rather than a preference.
