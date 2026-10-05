# Ease of use and motion — 2026-10-05

Follows 03. What already existed was checked first; this is only what was new.

Already there before this pass: Ctrl+K palette (topbar only), `Empty` state,
reduced-motion fallback, j/k on Audit and Magazine (`useQueueKeys`), the stage
strip (`WorkflowBar`) and the run screen's per-stage times.

## Ease of use

1. Errors lead to the fix. `plainError` returns `fix` ("models" | "resume");
   `Failed` adds "Open model settings" when the fix is a model.
2. Resume after a limit. `plainError` reads "resets in 2h30m" as `resetMs`;
   `RunError` offers "Resume at 4:05 PM" (from `lastError.at`), scheduled by
   `lib/resume-later.ts` — localStorage, fired by the shell every 15s.
   Limit: the app must be open at that time. Once the time has passed it says
   "The limit lifted at …" instead.
3. Run step bar: already existed (above). Added: elapsed time on the rail's
   run card; a stage that finishes on screen pops its dot.
4. One settings page. Setup tabs are Machine · Models · Agents · Project · MCP.
   `#/settings` and `#/mcp` still work and open those tabs. Rail: one
   "Settings" entry (was Models & setup, Project, MCP).
5. Palette visible everywhere: "Search · Ctrl K" in the rail (chat screens
   draw no topbar, so the hint was missing there).
6. List keys: j/k walk rows, tiles and the chapter table on any screen
   without its own queue; Enter opens; Esc presses the open panel's close
   button (`data-esc`). Screens with `useQueueKeys` keep their own j/k.
7. Empty states: about 15 plain "No … yet" lines became `Empty` (new
   `compact` variant for sidebars and menus), saying what goes there and,
   where one exists, the action that puts it there.

## Motion

1. Page changes use the View Transitions API (`lib/view-transition.ts`):
   cross-fade, plus a shared title for tile → issue page, tile → book, and
   chapter row → reader.
2. Stage dot pops when a stage finishes while you watch.
3. Chapters (book table) and production tiles: added rows rise in, removed
   rows fade out in place (`hooks/use-arrivals.ts`). Not on first load.
4. Numbers roll when they change (`components/ui/num.tsx`): Audit stats,
   book word and chapter counts. The app shows no costs, so none rolled.
5. Toasts stack, three at most; confirmations leave, failures stay 6s.

All respect prefers-reduced-motion.

## Not verified live

- The resume timer actually firing the POST (it would restart a real run).
  Scheduling, the stored entry and Cancel were driven in the browser.
- The rail elapsed time: no run was in flight.
- View-transition morphs were not watched (the pane does not draw); names
  were read back from computed style.
