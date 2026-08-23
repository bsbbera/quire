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
(`@actalk/inkos`), licensed **AGPL-3.0**. Quire does not include it — it starts
the copy installed on your machine and patches its page at runtime to add
resizable panels, English for strings outside its i18n table, a progress panel
and a Magazine section.

Quire is a separate work that runs alongside it. InkOS Studio remains the
property of its authors under its own licence, and its notice stays visible in
the sidebar. If you use Quire, you are also using InkOS Studio.

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
npm i -g @actalk/inkos
cd desktop && npm install && npm run dev
```

`cli-shim/deploy.ps1` pushes a changed shim into an installed build and restarts
it — the packaged app runs its own copy, so editing this tree alone changes
nothing until you deploy.

## Updates

Released builds update themselves. Quire checks on launch, silently; installing
waits for you unless you tick **Automatic** in Settings, because it owns two
child processes and relaunching mid-write is how a half-written chapter happens.

## Licence

Not yet chosen, so the default applies: all rights reserved by the author.

Worth deciding deliberately rather than by habit. Quire runs InkOS Studio as a
separate process and patches its page at runtime; whether that makes the pair a
combined work under AGPL-3.0 is a real question, and the answer decides whether
a permissive licence here is available at all. Publishing this source is what
the AGPL asks of a distributed combined work, so the public repo is the safe
side of that question either way.
