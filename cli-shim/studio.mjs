// Starts the InkOS Studio server WITHOUT the browser.
//
// `inkos studio` unconditionally spawns `cmd /c start "" <url>`, which throws
// the workbench into the user's default browser — the whole app then lives in
// Chrome and the desktop window is left holding only the settings. There is no
// flag to suppress it, so this reuses the CLI's own resolver + bootstrap and
// spawns just the server half.
import { execFileSync, spawn } from "node:child_process";
import { copyFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

// Keys that must not live in a tracked file (search providers, and anything
// else machine-local) come from a gitignored .env beside the repo. The spawned
// studio inherits process.env, so loading here is enough for the whole tree.
const ENV_FILE = join(dirname(fileURLToPath(import.meta.url)), "..", ".env");
if (existsSync(ENV_FILE)) process.loadEnvFile(ENV_FILE);

const PORT = process.env.STUDIO_PORT || "4567";
// The product was renamed from InkDesk to Quire, but the workspace holds real
// books and worlds - so an existing ~/InkDesk keeps being used rather than
// silently starting empty under the new name.
const ROOT = process.env.QUIRE_WORKSPACE
  || [join(homedir(), "Quire"), join(homedir(), "InkDesk")].find(existsSync)
  || join(homedir(), "Quire");

/**
 * Locate the InkOS runtime. Quire ships its own build of the fork in
 * ./inkos (staged by desktop/vendor-inkos.mjs, and carried into the
 * installer because Tauri bundles all of cli-shim as a resource), so that is
 * preferred. The global npm package stays as a fallback for a dev tree where
 * the fork has not been staged yet.
 */
const BUNDLED = join(dirname(fileURLToPath(import.meta.url)), "inkos");
const isBundled = () => existsSync(join(BUNDLED, "studio", "dist", "api", "index.js"));

function inkosRoot() {
  if (isBundled()) return BUNDLED;
  const guesses = [
    process.env.APPDATA && join(process.env.APPDATA, "npm/node_modules/@actalk/inkos"),
    join(homedir(), "AppData/Roaming/npm/node_modules/@actalk/inkos"),
    "/usr/local/lib/node_modules/@actalk/inkos",
  ].filter(Boolean);
  for (const g of guesses) if (existsSync(join(g, "package.json"))) return g;
  // Last resort: ask npm. Slow (~1s) but only runs when the guesses miss.
  try {
    const prefix = execFileSync("npm", ["root", "-g"], { encoding: "utf8", shell: true }).trim();
    const p = join(prefix, "@actalk/inkos");
    if (existsSync(join(p, "package.json"))) return p;
  } catch {}
  return null;
}

const pkg = inkosRoot();
if (!pkg) {
  console.error("inkos runtime not found — run: node desktop/vendor-inkos.mjs");
  process.exit(1);
}

const load = (rel) => import(pathToFileURL(join(pkg, rel)).href);
const { ensureProjectDirectoryInitialized } = await load("dist/project-bootstrap.js");

await ensureProjectDirectoryInitialized(ROOT, { language: "en" });

// With the staged runtime the entry point is known, so resolveStudioLaunch is
// not consulted: it hunts for a global npm layout or a monorepo checkout and
// finds neither here. It is still the right answer for the npm fallback.
const launch = isBundled()
  ? {
      studioEntry: join(BUNDLED, "studio", "dist", "api", "index.js"),
      command: process.execPath,
      args: [join(BUNDLED, "studio", "dist", "api", "index.js"), ROOT],
    }
  : await (await load("dist/commands/studio.js")).resolveStudioLaunch(ROOT);
if (!launch) {
  console.error("InkOS Studio build not found next to the inkos CLI");
  process.exit(1);
}

installStudioPatch(launch.studioEntry);

/**
 * Copy the Quire patch into Studio's own dist and reference it from its
 * index.html. Studio ships minified with ~415 Chinese strings outside its i18n
 * table, a hardcoded sidebar width and no progress display; this is the only
 * seam to fix those without its source. Re-run on every launch so an
 * `inkos update` that replaces the bundle gets re-patched instead of quietly
 * reverting.
 */
function installStudioPatch(entry) {
  try {
    // entry is <studio>/dist/api/index.js — the served root is <studio>/dist.
    const distDir = join(dirname(entry), "..");
    const indexHtml = join(distDir, "index.html");
    if (!existsSync(indexHtml)) return console.warn("studio patch: index.html not found");

    // Only /assets/* is served statically — anything else falls through to the
    // SPA and comes back as index.html.
    const src = join(dirname(fileURLToPath(import.meta.url)), "studio-patch");
    const files = ["patch.css", "patch.js", "geist.woff2"];
    const hash = createHash("sha1");
    for (const f of files) {
      const body = readFileSync(join(src, f));
      hash.update(body);
      copyFileSync(join(src, f), join(distDir, "assets", "quire-" + f));
    }
    // Cache buster. The asset paths are fixed, so the webview happily reuses a
    // cached copy from a previous version and the app looks unchanged after an
    // update - two releases in a row appeared to change nothing for exactly
    // this reason. The stamp is the content hash, so it moves only on a real
    // change and an unchanged patch still gets served from cache.
    const v = hash.digest("hex").slice(0, 8);

    let html = readFileSync(indexHtml, "utf8");
    if (html.includes(`quire-patch.js?v=${v}`)) return; // already wired, same content
    // Strip EVERY previously injected tag before adding the current set, under
    // either name. The product was renamed from InkDesk to Quire, so a Studio
    // bundle patched before the rename still carries inkdesk-* tags; leaving
    // them loads two copies of the patch. It also matches the mag-* pair, which
    // is how a bundle patched by an older Quire loses the magazine overlay:
    // the overlay is no longer written, so stripping it is the whole removal.
    html = html.replace(/^.*\/assets\/(inkdesk|quire)-(patch|mag)\.(css|js).*\r?\n/gm, "");

    html = html.replace("</head>", [
      `    <link rel="stylesheet" href="/assets/quire-patch.css?v=${v}">`,
      `    <script src="/assets/quire-patch.js?v=${v}" defer></script>`,
      "  </head>",
    ].join("\n"));
    writeFileSync(indexHtml, html);
    console.log("studio patch installed (panels, English, progress)");
  } catch (e) {
    // A failed patch must never stop Studio from starting.
    console.warn("studio patch skipped: " + e.message);
  }
}

const child = spawn(launch.command, launch.args, {
  cwd: ROOT,
  stdio: "inherit",
  shell: /\.(cmd|bat)$/i.test(launch.command),
  env: { ...process.env, INKOS_STUDIO_PORT: PORT },
});
child.on("exit", (code) => process.exit(code ?? 0));
child.on("error", (e) => {
  console.error("failed to start studio: " + e.message);
  process.exit(1);
});
