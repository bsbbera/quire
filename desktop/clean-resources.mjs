// tauri-build links bundled resources into target/<profile>/ and fails with
// "Cannot create a file when that file already exists (os error 183)" if the
// link survives from an earlier run. Clearing it before each build makes
// rebuilds repeatable instead of only working from a clean tree.
import { rmSync, existsSync, lstatSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
for (const profile of ["debug", "release", "dev-build"]) {
  const p = join(HERE, "src-tauri", "target", profile, "cli-shim");
  if (!existsSync(p) && !safeLstat(p)) continue;
  try {
    rmSync(p, { recursive: true, force: true });
    console.log("cleaned " + p);
  } catch (e) {
    console.warn("could not clean " + p + ": " + e.message);
  }
}

// existsSync follows links, so a dangling link reports false — check directly.
function safeLstat(p) {
  try { lstatSync(p); return true; } catch { return false; }
}
