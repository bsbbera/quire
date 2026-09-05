# 02 — UI: Vermilion Implementation Plan (Mock → App)

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

