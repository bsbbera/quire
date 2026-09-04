# 11 — Beyond: macOS, Mobile/iPad, Extra Features, Sellability

## macOS compatibility — feasible, in stages

Everything is Node + web UI, so the *core* ports cleanly. The blockers are all in the
integration edges (every one already flagged in 01/03/07):

| Blocker | macOS answer |
|---|---|
| CLI discovery (`where`, AppData paths) | `which` already handled; add mac install paths to the bins arrays |
| ComfyUI portable `.bat` + C:/D:/E: scan | No portable build on mac — support (a) existing Comfy installs (`~/ComfyUI`, `comfy-cli`), (b) **MLX engines** (`mflux`) for Apple Silicon, (c) API engines (09) as the zero-install default |
| `System32\tar.exe` | `/usr/bin/tar` exists — trivial |
| Affinity MSIX launch + Desktop sandbox | Affinity runs on macOS; launch via `open -a "Affinity Designer 2"`; verify the Canva MCP bridge exists on mac (it ships via Claude Desktop extensions — likely yes). If the bridge is Windows-only, the **Typst fallback renderer (07)** is the mac build path until it lands |
| Fonts (Bodoni MT, Franklin Gothic, Segoe Script are Windows-bundled) | Font preflight (07) + ship worlds on free faces (Lora, Libre Bodoni, Libre Franklin) so the same world renders on both OSes |
| `deploy.ps1`, packaged-app paths | Move to a cross-platform build (see below) |

**Step zero for both goals: `platform.mjs`** — one module owning paths, launch commands,
font enumeration, archive extraction. Then a packaging decision: the current shell is a
packaged MSIX; **Tauri** (small, Rust shell, WebView) or **Electron** (heavier, simpler)
gives Windows + macOS from one codebase. Given the app is already "Node servers + web
UI", Tauri sidecar-processes fit well.

## Mobile / iPad — yes for reading, no for creating (for now)

The creation pipeline needs local CLIs, a GPU, and Affinity — none exist on mobile.
Split the product:

- **Quire Reader (iPad/phone)** — consumes the static web-reader export (10). Route:
  ship the web reader as a PWA first (zero store friction, works today), then wrap
  with Capacitor for App Store presence if wanted. iPad + magazine flipbook is a
  natural, demo-perfect pairing.
- **Companion/remote (later)** — the desktop runs the engines; a mobile UI over the
  Studio API for *approvals* (read the chapter on the sofa, tap approve/redo, leave a
  tweak note). This is genuinely useful because the pipeline is gate-driven — and it's
  just the Studio API over the LAN/tailscale. Medium effort, high daily-use value.
- Full mobile creation: only viable as a cloud product (below). Don't attempt native.

## Recommended extra features (not covered in 01–10)

1. **Guided onboarding wizard** — first-run flow: detect CLIs → pick model → optional
   Comfy install (with the progress UI from 09) → optional Affinity link → create first
   book from a template. The doctor already knows all the checks; give it a face. This
   is the single biggest conversion feature for a paid product.
2. **Project templates** — "Kids' storybook (A5, picture-dominant, watercolor world)",
   "Tech zine", "Novel (6×9)". One click → production + world + styles pre-picked.
3. **Audiobook stage** — chapters → TTS (edge-tts free tier / ElevenLabs API) → m4b.
   Cheap to add, expands output formats.
4. **KDP/print-ready presets** — trim sizes, bleed, PDF/X export preset per template;
   users who *sell* their books will pay for this.
5. **Backup/sync** — the workspace is plain files; one-click zip snapshot + optional
   folder-sync guidance. Data-loss fear is real for 60-page projects.
6. **Usage meter** — per-issue token/image counts (chapter meta already tracks
   tokenUsage) so users see what their CLI subscription is spending.

## Can it be sold? Honest assessment

**Strengths that are actually rare:** end-to-end pipeline with human gates (not a
one-shot generator); local/private by default; uses subscriptions users already own
(near-zero marginal LLM cost — the anti-wrapper); real print output via Affinity;
provably tested core.

**Target buyer:** indie authors / zine makers / educators / agencies producing
children's books, zines, niche magazines — people who value *finished, printable
artifacts*, not chat.

**Pricing shape:** one-time or annual license for the desktop app (it uses the user's
own model subs, so per-seat SaaS pricing is hard to justify) + optional paid content
(world packs, style packs, templates) + later a cloud tier (hosted models/render for
users with no CLIs/GPU).

**Bar to clear before charging money** (in order):
1. Onboarding wizard + doctor-driven setup (friction kill).
2. One unified UI, translation debt gone (02).
3. Reader + Library shelf (10) — the demo moment.
4. Asset/recipe organisation (04) — the "it respects my work" feeling.
5. macOS build (doubles the market; creative buyers skew Mac heavily — this matters
   more for this product than for most).

**Risks to watch:** dependence on unofficial CLI behaviors (Claude/Codex flags change —
the 30 s re-detect helps but pin/tested versions per release); Canva's Affinity MCP is
young and could change; shipping model weights is fine (open licenses for Z-Image/FLUX
schnell) but verify each workflow's license before bundling downloads.

**Verdict:** the engine is sellable; the *experience* isn't yet. Phases 1–3 of the
overview plan (organisation → UI → integration hardening) plus the Reader are the
minimum sellable product. The design-engine work (06/07/08) is the moat — nobody else
has a taste-compounding, print-real pipeline — so it's what justifies a price, but it
can ship incrementally after the first sale-ready build.
