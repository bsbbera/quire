/**
 * Copy the tested dev build to IDEAVERSE\Quire-Backup.
 *
 * Step 2 of the release workflow: once a dev build is approved, it becomes the
 * thing you can fall back to if the release it turns into is bad. Nothing wrote
 * this folder before, so the backup sat at 0.1.16 while prod moved five
 * versions past it — a backup nobody could have restored anything useful from.
 *
 * Deliberately copies the *dev install*, not the build output: that is the
 * exact tree that was tested, .env and all.
 */
import { cpSync, existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DEV_INSTALL, BACKUP_DIR, versionOf } from "./stages.mjs";

const src = DEV_INSTALL;
const dest = BACKUP_DIR;

if (!existsSync(join(src, "quire.exe"))) {
  console.error(`no dev build at ${src} — run build-dev.mjs first`);
  process.exit(1);
}

// A running app holds cli-shim open; EBUSY here means the copy would be a
// half-tree, which is worse than no backup at all.
try {
  rmSync(dest, { recursive: true, force: true });
} catch (err) {
  if (err.code === "EBUSY") {
    console.error(`cannot replace ${dest} — something is holding it open. Close it and re-run.`);
    process.exit(1);
  }
  throw err;
}

mkdirSync(dest, { recursive: true });
cpSync(src, dest, { recursive: true });

const version = versionOf(join(dest, "quire.exe"));
// Say what this is a backup *of*. A bare folder of binaries tells you nothing
// six weeks later about which release it predates.
writeFileSync(
  join(dest, "BACKUP.txt"),
  `Quire ${version ?? "unknown"}\nbacked up ${new Date().toISOString()}\nfrom ${src}\n`,
  "utf-8",
);
console.log(`backed up Quire ${version ?? "?"} to ${dest}`);
