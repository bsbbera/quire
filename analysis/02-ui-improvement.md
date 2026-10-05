# 02 — UI: Vermilion Implementation Plan (Mock → App)

## Revision 2026-10-05 — one generic UI, nothing hardcoded (supersedes the waves' order)

**User decision:** the app has one generic UI. Every page is built from the same
components and tokens; nothing is styled by hand per page. One motion language
everywhere. The only "extra" animations are the working states: searching,
planning, thinking/writing, generating.

**Where it stands (measured 2026-10-05, `packages/studio/src`)**
- 39 pages; 11 use the Vermilion classes. Two stylesheets: `index.css` (1,513 lines,
  legacy + tokens) and `vermilion.css` (2,257 lines).
- Hand styling in pages: **593** inline `style={{…}}`, **246** arbitrary `[NNpx]`
  sizes, 13 raw hex colours.
- Motion: 24 `@keyframes` split across the two files, durations scattered (100,
  120, 200, 240, 260, 300, 480 ms…); the `motion` package is used in one file.
- Shared components exist but are thin: `components/ui/` has button, input, select,
  dialog, badge, states, `vermilion.tsx` — no Card, Row, Rail item, Gate, Verdict,
  Progress, Empty/Error/Loading as one set.
- The motion grammar is already written (`design/vermilion-redesign-plan.md` §5:
  one easing, 150/300 ms, 640 ms reveals, reduced-motion = jump to end). It is law;
  it was never built as code.

**The rule set**
1. **Tokens only.** Colour, space, radius, type size, shadow, duration and easing come
   from CSS variables. No hex, no `[NNpx]`, no inline `style` for anything a token
   covers (inline style stays allowed only for computed geometry, e.g. a measured width).
2. **Components only.** Pages compose shared parts; a page never defines its own card,
   row, button look or empty state. The set (build once, in `components/ui/`):
   Page shell · Section · Card · List row · Toolbar · Tabs · Field · Status dot ·
   Gate · Verdict · Progress (ring + bar) · Job card · Drawer · Toast ·
   Empty / Loading / Error states.
3. **One motion file.** `motion.css` (+ a tiny hook if React needs it) holds the
   tokens `--ease`, `--t-fast` 150 ms, `--t-move` 300 ms, `--t-reveal` 640 ms and the
   §5 patterns. Transform/opacity only. `prefers-reduced-motion` ends every animation
   at its final state.
4. **Working-state animations** — the only ones beyond the grammar, each one
   component, used everywhere the state occurs:
   *Searching* (sweep), *Planning* (steps filling), *Thinking/writing* (word stream +
   caret), *Generating* (ring progress). Never in or beside the reading column
   (`PRODUCT.md`, Accessibility).
5. **One stylesheet.** `vermilion.css` becomes the system; `index.css` is reduced to
   resets and deleted when the last page has moved.
6. **A guard, not a promise.** One check script (run with the tests) counts inline
   styles, `[NNpx]` and hex in `pages/`; the count may only go down. Target 0.

**Status 2026-10-05: done (code), awaiting your look.**
- Guard: `ui-guard.test.ts`, which bans literal inline styles, `[Npx]`, hex and
  Tailwind palette colours in `pages/` and `components/`. All four counts are 0.
  At the start there were 593 inline styles, 246 `[px]` and 13 hex.
- Tokens: one palette (the shadcn names point at vermilion), a type lock of
  11 steps, three radii, one motion set. Tailwind's own scales are snapped onto them.
- `motion.css`: the grammar plus the four working states, and reduced motion
  ends every animation where it was going. Keyframes are down from 24 to 9;
  ~40 spinners drawn three different ways are now one `Spinner`.
- Components: `components/ui/working.tsx` (Working, Spinner, Ring, Bar). Card,
  row, tabs, gate, drawer, toast, field and the message bars stay classes, not
  React wrappers. A wrapper would add nothing a class does not.
- Pages: 22 shadcn-era pages are moved onto the system's `panel`, `btn`, `input`,
  `label`, `pill`, `well` and the message bars (about 280 elements). The `q-`
  kit and the unused `.aud` block are deleted.
- `index.css` cannot be deleted, because it is Tailwind's entry. It is now
  wiring only (~120 lines, from 1,513).
- Checked: computed styles of 27 pages diffed before/after at 1280×720, plus
  screenshots in light and dark at desktop and narrow widths. Studio suite: 843 pass.
- Left for segment 3: Setup/Services/Model routing are restyled but not
  restructured, because the Connections screen (plan 20) replaces them.

**Order** — foundation first, then pages by time on screen:
1. Tokens audit + `motion.css` + the component set above, with a style-guide page
   (`StyleGuide.tsx` exists — make it the living catalogue).
2. Home/Dashboard, Run, Audit, Chapter reader, Publication detail, Gallery.
3. Setup → Connections (plan 20 revision), Model routing, Taste, Settings.
4. Everything left; delete `index.css`; guard at 0.

Done when: every page renders only shared components, the guard reads 0, and the
same action (approve, rerun, open drawer, finish a job) looks and moves the same on
every screen.

> This file replaced the original "UI improvement" analysis in place: the Vermilion
> mock decided the direction, so improvement == implementing the mock. **This is the
> FIRST plan to implement** (then 14 workflow, then 15 model).

> Verified 2026-08-30 against BOTH sides:
> • **Mock (source of truth):** `Quire-Prod/analysis/mock/` — 47 screens, `vermilion.css`
>   (screen-agnostic component vocabulary), `mock.js` (icon sprite, theme, data-go router,
>   seg/tabs, j/k/a/i keys, toasts), `_rail.py` (IA + owner mapping), `_gen.py` (shell frame),
>   `index.html` (contact sheet + THESIS/STORY/FORM contracts per screen).
> • **App (what exists):** `Quire-Dev/vendor/studio/packages/studio` — React 19 + Vite 6 +
>   Tailwind v4 + shadcn, hash router (`src/hooks/use-hash-route.ts`), `use-api.ts`,
>   `use-sse.ts` (allowlisted events), zustand stores, bilingual i18n (`use-i18n.ts`,
>   default **zh**), and Vermilion tokens ALREADY landed in `src/index.css`
>   (+ `desktop/ui/app.css` mirror for the Tauri boot shell).
>
> Therefore this is NOT a rebuild. It is a **screen-by-screen refactor of the existing
> React app to the mock**, plus new screens the app lacks. The old plan's
> "rebuild frontend from scratch / quire-ui package" is dead; the design system lives in
> `src/index.css` (vermilion.css merged into it) and that is fine.

## Status (2026-09-07) and the screens the other plans now need

Landed since 2026-08-30 (engine commits 2026-09-05..07): Home counts creations
(`Dashboard.tsx`, "Waiting on you" gates), run screen with gate sign-off + withdraw,
jobs rail card fed by `use-jobs.ts` above the router, audit screen rebuilt (reading
column sized to the pane, findings queue, per-file voice pill, restyle control), voice
library, Model Routing page, Settings with workspace picker. Still ui.html-era: setup/
connection, image review, design, worlds, reader.

**New screens/controls required by the updated plans** (each is specified in its
plan; listed here so the UI sequence stays one list):

| Screen / control | Plan | Why it is the next UI |
|---|---|---|
| **Connections** page (provider connected/sign-in/connect-via) replacing CLI toggles | 20 §3 | "open app → pick models → done" |
| Models page: preset knob (Best/Balanced/Frugal) + resolved table with reasons | 20 §4 | make routing invisible by default |
| **Gallery** tab per creation: approve / redesign-with-note / delete / trash; inline images in audit | 04 | the design gate is blind without it |
| **World card** in the design gate; Design page; World library | 08 §6 | show the design language, allow re-world |
| Finding row **Fix (rewrite)** with span preview + inline diff | 19 §5b | the audit's missing verb |
| Style mixer (≤5 rows, weights, facets, "hear a sample"); distance before/after pill | 05 §3–4 | authenticity made visible |
| "Where and when" intake block; `setting` clarification card; Setting tab; Settings library | 22 §5 | the main sauce of writing |
| Engine settings (Comfy install/benchmark visible), workflow & LoRA manager, per-surface default engine + fallback sentence | 09 §6, 23 §8 | the 11 GB download is invisible today |
| **Section board** = unit of approval: world swatch strip, **Kit card** (gradients/patterns/ornaments/FX/type specimen), opener thumbnail, beats, first copy proof; keep / re-world / pick from library / lock | 13 §2, §4b; 07 §1b | design is finalised before anything is built |
| **`<Verdict>`** component everywhere (keep / redo / tweak / reject) with **"what went wrong?" cause chips** per surface | 04 §7, 18 §1 | one feedback gesture on every artefact |
| **Final folder** card on every creation: drop zone / "open final/" + **Learn from final** button + last-ingest summary ("12 edits, 3 kit assets, 2 palette shifts") | 04 §6 | the compounding loop, one manual trigger |
| **Canva connection card** (OAuth, plan, allowance estimate, plain-language "what Canva does here"); fallback notice on gate cards and job rows; "Make promo set" on the build gate | 23 §8 | second image engine, derivatives |
| Kit library page (browse kits, previews, promote drafts) beside World library | 07 §1b | reuse instead of re-create |

**Simplest possible integration of all of the above** (the user's ask): three
surfaces only — (1) the **Section board / World card** is where design is decided,
(2) the **gates** are where it is judged, with the same `<Verdict>` control on every
card, (3) the **Final folder card** is where the user's finished work comes back in.
Nothing else is new chrome; Canva, kits and engines surface only as pills, notices and
one Settings card.

**Status & feedback suggestions** (cheap, high trust):
- Every transcript block and job row shows **agent · model** pill (roster + resolver
  already know both).
- **Cost meter** per run from `usage.x_quire` (exists, unused in UI) — tokens and $ so
  far, budget ceiling from 20 §4.
- Gate cards say *what happens next* ("approving starts art for 12 spreads, ~6 min").
- Degraded-mode banners from preflight ("ComfyUI not running — design stage will
  wait"), with the fix action inline.
- Desktop notification when a gate opens (core has `notify/`); the app is left
  running for long stages and the user should not have to watch it.
- RunPage renders from `pipeline.json` (units done/failed/stale per stage), not from
  SSE replay — a reload then shows the truth.

## 0. Ground rules (from the mock's own contracts — keep as law)

1. **No screen file contains local styles.** All components live in the shared
   stylesheet; nothing in it knows what screen it's on. Enforce: ESLint rule banning
   `style={{…}}` except for `--vars`, and no new `.css` per page.
2. **One icon sprite** (24px grid, 1.6 stroke, round caps, no fills) — port `mock.js
   ICONS` into a `<Icon name>` component; delete lucide-mixing.
3. **Shell answers two questions before content:** what is the machine doing (rail
   run card) and what does it need from me (topbar waiting pill + Home queue).
4. **Charcoal = the work itself** (chat, chapter, passage, player, flow canvas, logs).
   Chrome stays putty/paper.
5. **Gate pattern:** every call-to-action states *what* + *when* and offers a single
   vermilion action (`.gate`/`.gatepill`).
6. **Three theme states** (OS default / light / dark), persisted.
7. **English-first strings**: flip `app-language.ts` default to `en`; keep the
   bilingual `t()` table (it's already the right mechanism — do NOT rip it out);
   fill missing `en` values; the runtime `studio-patch/patch.js` translation dies
   once §2 screens are done.
8. Keyboard: `j/k/a/i` on every queue (audit, taste, review), `⌘K` palette (new).

## 1. Foundation tasks (before any screen)

| # | Task | Where |
|---|---|---|
| F1 | Merge `analysis/mock/vermilion.css` into `packages/studio/src/index.css`; reconcile with Tailwind v4 theme vars; delete any legacy token not in the mock | `src/index.css` |
| F2 | Port `mock.js` behaviors to React: `<Icon>` sprite, `useTheme` (3-state), `<Seg>`, `<Tabs>`, `<Toast>` queue, `useQueueKeys(j/k/a/i)`, reveal-on-scroll | `src/components/ui/` |
| F3 | Build the shell frame from `_gen.py`: `.titlebar` (custom Tauri titlebar — set `decorations:false` in tauri confs, add drag region + window controls; keep native on macOS traffic-light side), `.rail` from `_rail.py` IA (Working / System / Tools groups, owner→child aria-current logic mapped onto the hash router), `.topbar` (crumbs + pills + primary action), `.stage` | `src/App.tsx`, `src/components/shell/`, `desktop/src-tauri/*.conf.json` |
| F4 | Rail live run card (`.railrun`) fed by `use-sse.ts`; topbar "waiting on you" pill (needs 14's gates API; until then derive from existing `pendingReview` counts) | shell |
| F5 | `/styleguide` route rendering `26-styleguide.html`'s content from the real stylesheet — the living reference; Playwright snapshots light+dark | new page |
| F6 | ⌘K palette (navigate to every route, actions later) | shadcn Command |

## 2. Screen-by-screen: mock ↔ existing page ↔ work needed

Legend: **Restyle** = same data/logic, new markup per mock · **Rework** = logic changes
too · **New** = page doesn't exist. Order = implementation order.

### Wave 1 — daily-driver screens
| Mock | App page (exists) | Work |
|---|---|---|
| 01-shell | `App.tsx` layout | Rework (F3) |
| 02-home | `Dashboard.tsx` | Rework: machine-queue-first (waiting list from gates/pendingReview, month numerals, live run card, recent tiles). Kill hero-metrics layout |
| 03-books | (part of Dashboard today) | New page `BooksPage`: tile grid, disc-mark per production type, filter pills, dashed New tile |
| 27-chat | `ChatPage.tsx` | Restyle: charcoal `.chat/.convo/.thread/.composer`; keep the 4-mode architecture (chat/book/book-create/film-author) — mock explicitly endorses it |
| 04-book | `ChatPage mode="book"` | Restyle: book column (chapters/truth pointers) beside conversation |
| 06-chapter | `ChapterReader.tsx` | Restyle: charcoal read surface, big numeral, readbar (size/measure/leading live CSS vars, persisted) |
| 07-review | (inside ChapterReader?) | Rework: verdict bar (keep/change/strike) at bottom of the reading card, wired to approve/reject routes |
| 08-audit | `AuditPage.tsx` (already vermilion-touched) | Rework: 3-col scope/queue/passage, j/k/a/i, structured findings w/ offsets (needs core change — see 14/17); Accept-fix applies reviser patch |
| 09-run | (scattered SSE displays) | New page `RunPage`: universal `.thread` transcript + stage dots + ring, fed by typed SSE (15 §2.2); Home's run card links here |
| 25-states | n/a | Component work: empty/loading/fail/finish state kit used by all pages |

### Wave 2 — machine screens
| Mock | App page | Work |
|---|---|---|
| 30-providers / 31-provider | `ServiceListPage.tsx` / `ServiceDetailPage.tsx` | Restyle: connected-first sorting, key-never-shown, test action |
| 41-project | `ProjectSettings.tsx` | Restyle; **keep the agent→model routing block here** (mock law: connections ≠ routing; this is where 15's router pins surface) |
| 21-setup | `SetupPage.tsx` | Rework: machinery panels (CLI providers via shim `/status`, ComfyUI panel wired to `/comfy/*` + install progress, Affinity panel, MCP link) |
| 22-doctor | `DoctorView.tsx` | Restyle + first-run walk (top-to-bottom reveal until required checks pass) |
| 32-mcp | `McpPage.tsx` | Restyle: tools-as-unit rows, plain-language capability, scope warnings |
| 33-daemon | `DaemonControl.tsx` | Restyle: one big reversible switch + event window |
| 34-logs | `LogViewer.tsx` | Restyle: level filter, mono, the one terminal-looking screen |
| 36-analytics | `Analytics.tsx` | Restyle: "where is it stuck" stacked bar + per-chapter rows |

### Wave 3 — craft tools
| Mock | App page | Work |
|---|---|---|
| 05-truth | `TruthFiles.tsx` | Restyle: authority-tier order visible |
| 37-genres | `GenreManager.tsx` | Restyle: rules-as-what-they-forbid, chips |
| 38-style | `StyleManager.tsx` | Restyle + connect to style packs (05/18) |
| 39-translation | `TranslationManager.tsx` | Restyle: facing columns + glossary |
| 40-import | `ImportManager.tsx` | Restyle: five acts, five forms (tabs) |
| 28-new | (sidebar actions today) | New page: 13 start-ways grouped by what user provides |
| 29-create | `ChatPage mode="book-create"` | Restyle: seeded questions + margin folder |
| 35-radar | `RadarView.tsx` | Restyle: dated recommendations, confidence arcs |
| 42-book-settings | `BookDetail.tsx` | Restyle: identity/state/export; destructive delete isolated at bottom w/ dialog |

### Wave 4 — magazine (needs 14's per-page APIs; mock 10–14)
| Mock | App page | Work |
|---|---|---|
| 10-issue-brief … 14-issue-build | `PublicationDetail.tsx` (single page today) | Rework into 5 tab-stage views: Brief, Sections (world columns + plan gate), Pages (flatplan grid w/ pacing rules), Page detail (render + copy/spec/art + 4 verdicts), Build (gate chain + Affinity-as-printer + PDF card) |

### Wave 5 — "drawn, not shipped" (new features; backend in 04/08/09/18)
| Mock | Work |
|---|---|
| 15-images / 16-tweak | New: candidate grid + queue strip; tweak = brush + one sentence (inpaint recipe) |
| 17-library | New: asset grid + recipe sidecar panel |
| 18-worlds / 19-composer / 20-taste | New: world gallery at real size; 3-list composer w/ live sample; taste queue (reuses audit pattern + j/k/a/i) |
| 23-reader / 24-beauty | New: reader takes the room (icon rail, edge-to-edge); beauty gate judges spreads at spread size |

### Already-good screens (restyle only, low priority)
43-play (`StoryPlayer`), 44-graph (`StoryGraphTree`), 45-film-studio (`FilmWizard`),
46-flow (`FlowView`), 47-film-author (`ChatPage` mode).

## 3. Wiring gaps the UI needs from other plans

| UI element | Needs | Plan |
|---|---|---|
| Waiting pill + Home queue | gates/pending API per production | 14 §4 |
| Run thread typed states (think/tool/stream/fail) | typed SSE deltas from shim | 15 §2.2 |
| Audit Accept-fix | findings with `{para,start,end}` offsets + patch apply | 14 task 3, 17 §2 |
| Issue Pages/Page/Build tabs | pipeline.json + per-page rerun/verdict routes | 14, 13 |
| Images/Library/Tweak | sidecar recipes + jobs queue | 04, 09, 14 |
| Worlds/Composer/Taste | world specs + proposals API | 08, 18 |
| Setup Comfy/Affinity panels | shim endpoints exist; SSE progress | 14 §3.1 |

Until a dependency lands, build the screen against a typed mock of the route
(contract file in `src/api-contracts/`), so UI and backend meet at a written contract.

## 4. Delivery discipline

- One screen per PR, containing: refactored page, strings added to `use-i18n.ts`
  (en+zh), Playwright snapshot, and removal of any patch.js dict entries it obsoletes.
- Test over HTTP per CLAUDE.md (dev Studio :4568); `node desktop/build-dev.mjs` for
  shell-affecting changes only.
- Definition of done per screen = matches mock in both themes + keyboard path works +
  no local styles + no hardcoded zh/en strings outside the i18n table.
- Final acceptance for the whole effort: `studio-patch/patch.js` translation dict and
  `cli-shim/ui.html` are deleted; every route renders the Vermilion shell; the mock's
  contact sheet and the app screenshot-diff within tolerance.

