# Quire workflow rule

Three stages, three places. `desktop/stages.mjs` is the one file that names them.

| Stage | Where | Written by |
|---|---|---|
| dev | `~\IDEAVERSE\Quire-Dev` | `desktop/build-dev.mjs` |
| backup | `~\IDEAVERSE\Quire-Backup` | `desktop/backup-build.mjs` |
| prod | `~\IDEAVERSE\Quire-Prod` | the NSIS installer / in-app updater |

`~\IDEAVERSE\Quire-Dev` is the checkout and the running dev app, one folder.
`cli-shim/` there is already the staged runtime, so a build only drops
`quire.exe` beside it - it must never delete and re-copy that directory, which
would take the source with it.

**No install may sit under `%LOCALAPPDATA%`.** The agent running these scripts
is packaged, so its writes under AppData are redirected into a per-package
shadow: the build prints that it deployed, the folder the shortcut points at is
untouched, the app keeps launching an older build, and every check made from
inside that sandbox reads the shadow and passes. An entire session was reported
as verified against a copy the user could not open.

All new work happens on branch `dev`, built and tested as `Quire-Dev`.
Testing is done over the HTTP API, never a browser view or a screenshot —
see "Driving the app" below.

## Releasing

Three gates, each needing the user's explicit approval in chat. Never skip
ahead; approval for one gate is not approval for the next.

**Gate 1 — the dev build is good.** After they have tested it:

1. `node desktop/backup-build.mjs` — copies the tested dev install to
   `Quire-Backup`, so there is something to fall back to.

**Gate 2 — ship it.** Only after they approve the release itself:

2. Bump the version **on `dev`** in `desktop/package.json`,
   `desktop/src-tauri/tauri.conf.json`, `desktop/src-tauri/Cargo.toml`,
   `desktop/src-tauri/Cargo.lock`.
3. Merge `dev` into `master`. The bump travels with the merge.
4. Push `master`, tag `vX.Y.Z`, push the tag.
5. GitHub Actions builds and publishes the release.
6. Prod updates itself in place from
   `https://github.com/bsbbera/quire/releases/latest/download/latest.json`.
   No reinstall.

**The bump happens on `dev`, before the merge — never on `master` after it.**
Bumping on `master` leaves `dev` a version behind on every single release,
which is how `Quire-Dev` ended up at 0.1.20 while prod was 0.1.21, and why the
dev build then tried to "update" itself into prod on every launch, forever.
`node desktop/check-stages.mjs` asserts dev >= prod and fails loudly if not.

## Driving the app

Never a browser pane, never screenshots. Both Quire builds serve an HTTP API,
and that is the test surface:

- dev: shim `8788`, Studio `4568`
- prod: shim `8787`, Studio `4567`

`node desktop/quire-ctl.mjs <dev|prod> <path> [json]` is the wrapper — it
resolves the port, so nothing has to remember which build is on which.

Never commit or push `.env` or the API keys it holds, under any circumstances.
