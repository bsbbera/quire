# Quire

A quire is the gathering of folded sheets that makes one signature of a book.
This is a desk for producing them: research and write a magazine or a book, make
the artwork, and lay the pages out — without leaving the app or hand-carrying
files between four tools.

Quire is a Tauri shell around three things that already work well separately:

- **A model shim** that finds the agent CLIs installed on your machine — Claude
  Code, Codex, Devin, Antigravity — and exposes every model they offer through
  one local OpenAI-compatible endpoint on `127.0.0.1:8787`. No API keys of its
  own; it borrows the ones you already signed in with.
- **MCP discovery** that reads the servers configured for Claude Desktop, Claude
  Code, Codex and Devin where they already live, rather than asking you to
  declare them a second time.
- **A build pipeline** — a magazine goes from subject to laid-out pages through
  research, a flatplan, per-page copy, ComfyUI artwork and an Affinity layout.

## The workbench

The editor you see is **[InkOS Studio](https://github.com/Narcooo/inkos)**
(`@actalk/inkos`), licensed **AGPL-3.0**. Quire runs a **fork** of it, kept in
`vendor/studio` and staged into `cli-shim/studio` by `desktop/vendor-studio.mjs`.
Publication types, the audit and revise loop, and the publication routes are
changes to that source, not decoration added to a running copy of someone
else's.

It did not start that way. Until the fork, Quire started whatever InkOS was
installed on the machine and patched its page at runtime; `cli-shim/studio-patch`
is what remains of that, and it is being retired rather than extended.

InkOS Studio remains the property of its authors under its own licence, and its
notice stays visible in the sidebar. If you use Quire, you are also using InkOS
Studio.

## Layers

Three concerns, deliberately kept apart because they change at different speeds:

| Layer | Owns | Changes |
|---|---|---|
| content | what is true, what is said | every issue |
| design system | layout, fonts, colours, grids | every issue, learned from references and feedback |
| affinity | how to make Affinity produce it | rarely — it is Affinity's tool set, not the design's |

The mechanism layer lives in [`ideaverse-skills`](https://github.com/bsbbera/ideaverse-skills)
as the `/affinity` skill; the taste layers are `/mag-content` and `/mag-design`.

## Running it

```bash
node desktop/vendor-studio.mjs   # build vendor/studio, stage it into cli-shim/studio
node quire.mjs                  # shim + Studio on http://localhost:4567
```

**Editing `vendor/studio` changes nothing until it is staged.** The app runs
`cli-shim/studio`, which is a build output, so `vendor-studio.mjs` is not optional
after a source change. Stop the app before staging — Windows will not overwrite
files it still holds open.

`cli-shim/deploy.ps1` does the same for an already-installed build.

## Updates

Released builds update themselves. Quire checks on launch, silently; installing
waits for you unless you tick **Automatic** in Settings, because it owns two
child processes and relaunching mid-write is how a half-written chapter happens.

## The rest of the docs

| | |
|---|---|
| [`docs/WHERE-THINGS-ARE.md`](docs/WHERE-THINGS-ARE.md) | What belongs to which project, the six work types, and which folders the app actually reads |
| [`docs/QUIRE-PLAN.md`](docs/QUIRE-PLAN.md) | The plan. Phases 1-7 done, 8 open. |
| [`docs/DEBT.md`](docs/DEBT.md) | Everything skipped, stubbed or unverified, and what closing it takes |
| [`docs/specs/`](docs/specs) | Specs for the authoring skills, and the superseded first plan |

## Licence

Not yet chosen, so the default applies: all rights reserved by the author.

Worth deciding deliberately rather than by habit — and the fork settles the
part that used to be arguable. Quire no longer merely runs InkOS Studio beside
itself; it ships a modified copy, which is a derivative work under AGPL-3.0 on
any reading. Publishing this source is what the licence asks, so the public
repo is not a precaution any more, it is the term being met.
