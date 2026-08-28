/**
 * The three places a Quire build can live, in one file.
 *
 * These were spread across build-dev.mjs, an NSIS registry key and a pair of
 * hand-made folders, which is how the dev install, the prod install and the
 * backup ended up at three unrelated versions with nothing to notice it.
 */
import { execFileSync } from "node:child_process";
import { homedir } from "node:os";
import { join } from "node:path";

/**
 * Where build-dev.mjs deploys. This is the checkout and the running dev app,
 * one folder, which is what was asked for and what the desktop shortcut points
 * at. `cli-shim/` is already the staged runtime here - vendor-studio.mjs writes
 * it - so a build only has to drop `quire.exe` beside it.
 *
 * It may never move under %LOCALAPPDATA%. The agent that runs these scripts is
 * packaged, so its writes under AppData are redirected into a per-package
 * shadow: the build prints that it deployed, the folder the shortcut points at
 * is untouched, the app keeps launching an older build, and every check made
 * from inside that sandbox reads the shadow and passes. A whole session was
 * verified against a copy the user could not open.
 */
export const DEV_INSTALL = join(homedir(), "IDEAVERSE", "Quire-Dev");

/** The approved dev build, kept so a bad release can be rolled back. */
export const BACKUP_DIR = join(homedir(), "IDEAVERSE", "Quire-Backup");

/**
 * Where the NSIS installer puts prod. Not chosen here — the installer reads it
 * from HKCU\Software\subhadip\Quire — but named here so the checks can compare.
 */
export const PROD_INSTALL = join(homedir(), "IDEAVERSE", "Quire-Prod");

/** ProductVersion off an exe, or null if it cannot be read. */
export function versionOf(exe) {
  if (process.platform !== "win32") return null;
  try {
    const out = execFileSync("powershell", ["-NoProfile", "-Command",
      `(Get-Item -LiteralPath '${exe}').VersionInfo.ProductVersion`], { encoding: "utf-8" });
    return out.trim() || null;
  } catch { return null; }
}
