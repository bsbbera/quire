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

/** Where build-dev.mjs deploys. Not a repo checkout: this is an install. */
export const DEV_INSTALL = join(homedir(), "AppData", "Local", "Quire-Dev");

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
