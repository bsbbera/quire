# Quire workflow rule

All new work happens on branch `dev`, tested locally as `Quire-Dev`
(`desktop/build-dev.mjs` → deploys to `%LOCALAPPDATA%\Quire-Dev`).

Never merge `dev` → `master` or tag a release without the user's explicit
approval in chat after they've tested the dev build. On approval:

1. Merge `dev` into `master`.
2. Bump version in `desktop/package.json`, `desktop/src-tauri/tauri.conf.json`,
   `desktop/src-tauri/Cargo.toml`, `desktop/src-tauri/Cargo.lock`.
3. Push `master`, tag `vX.Y.Z`, push the tag.
4. GitHub Actions builds and publishes the release automatically.
5. Every installed Quire-Prod auto-updates via its in-app updater (Tauri
   updater polls `https://github.com/bsbbera/quire/releases/latest/download/latest.json`)
   — no manual reinstall needed once this fires.

Never commit or push `.env` or the API keys it holds, under any circumstances.
