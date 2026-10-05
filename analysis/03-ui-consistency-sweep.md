# UI consistency sweep — 2026-10-05

Found by scanning every Studio `.tsx` (TypeScript parser, not regex) and
`vermilion.css`. Trigger: the Audit page dumped a raw provider error (JSON)
that ran past the panel edge.

| # | Issue | Where | Fix |
|---|---|---|---|
| 1 | Raw machine errors shown as-is (JSON, stack text) | 29 files / 44 places | `Failed` reads errors through `plainError()`; raw text folds under "Details" |
| 2 | Errors drawn ad hoc (`text-destructive`, red boxes) | 23 files / 42 places | page/section errors → `Failed`; inline → `hint is-bad` |
| 3 | Browser `alert()` popups | 25 calls (BookDetail, GenreManager) | `toast()` with a failure tone |
| 4 | Browser `window.confirm()` | 4 calls | `ask()` → the app's ConfirmDialog |
| 5 | Loading as plain "Loading…" text | 14 places | `Loading` / `Spinner` |
| 6 | Two input looks: bare inputs (putty, 1px, 8/12) vs `.input` (paper, 1.5px, 9/12) | ~25 bare controls | bare rule made identical to `.input` |
| 7 | Bare / hand-styled buttons | 52 buttons | `btn` / `btn-line` / `btn-quiet` / `btn-icon` |
| 8 | Hand-drawn boxes (`border` + `rounded` + fill/padding) | 63 places | `panel` / `well` / `pop` / `pill` / `pass` / `caution` |
| 9 | Two icon sets: lucide in 44 files beside the house sprite | ~95 glyph names | lucide names map onto the house sprite; missing glyphs drawn in the same 24px/1.6 stroke |
| 10 | Raw px type sizes in CSS, some off-scale (9, 10.5, 11.5, 15, 16, 17, 30) | 108 declarations | `--fs-*` tokens |
| 11 | Raw px radii in CSS | 3 control radii (6–8px) | `--r-ctl` |

The UI guard test (`src/__tests__/ui-guard.test.ts`) bars 3, 4, 8, 9 and 10 from coming back.

Found while fixing:

| # | Issue | Where | Fix |
|---|---|---|---|
| 12 | `.row` (list row: top rule, hover slide) used as a layout row | AuditPacks, 5 places | `rowflex` |
| 13 | `button, input… { color: inherit }` outranked the field rule, so bare fields took their label's muted colour | vermilion.css | made zero-specificity |
| 14 | Selectable cards each drew their own "selected" colours | ChatPage skills, language picker, prompts, translations | `well` + `aria-pressed` |

## Status 2026-10-05: done (code)

All 14 fixed. tsc clean; studio suite 88 files / 849 tests, including the
guard's four new checks (verified with a probe file that each one fails).
Browser: 24 routes walked, no console errors, no missing icons, no
horizontal overflow; error box, failure toast and ask() dialog driven and
read back.

Left on purpose: status colour maps on the `--bad` token (consistent),
sidebar/menu rows with their own component CSS, 2–5px radii on marks and
swatches, and the now-unused `lucide-react` and `motion` packages in
package.json (removing them changes the lockfile).
