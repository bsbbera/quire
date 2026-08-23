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

const PORT = process.env.STUDIO_PORT || "4567";
// The product was renamed from InkDesk to Quire, but the workspace holds real
// books and worlds - so an existing ~/InkDesk keeps being used rather than
// silently starting empty under the new name.
const ROOT = process.env.QUIRE_WORKSPACE
  || [join(homedir(), "Quire"), join(homedir(), "InkDesk")].find(existsSync)
  || join(homedir(), "Quire");

/** Locate the globally-installed @actalk/inkos package. */
function inkosRoot() {
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
  console.error("inkos not found — install it with `npm i -g @actalk/inkos`");
  process.exit(1);
}

const load = (rel) => import(pathToFileURL(join(pkg, rel)).href);
const { ensureProjectDirectoryInitialized } = await load("dist/project-bootstrap.js");
const { resolveStudioLaunch } = await load("dist/commands/studio.js");

await ensureProjectDirectoryInitialized(ROOT, { language: "en" });

const launch = await resolveStudioLaunch(ROOT);
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
    const files = ["patch.css", "patch.js", "mag.css", "mag.js"];
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
    if (html.includes(`quire-mag.js?v=${v}`)) return; // already wired, same content
    // Strip EVERY previously injected tag before adding the current set, under
    // either name. The product was renamed from InkDesk to Quire, so a Studio
    // bundle patched before the rename still carries inkdesk-* tags; leaving
    // them loads two copies of the patch and the Magazine nav appears twice.
    html = html.replace(/^.*\/assets\/(inkdesk|quire)-(patch|mag)\.(css|js).*\r?\n/gm, "");

    // Rename in the HTML itself, and rename again the instant the SPA paints.
    // The patch scripts are deferred, so for the first moment of every launch
    // Studio's own "InkOS Studio" title and first paint were visible - the
    // rename could only ever run after the flash the user actually complained
    // about. This inline script has no such gap.
    html = html.replace(/<title>[^<]*<\/title>/, "<title>Quire Studio</title>");
    const early = '<script>(function(){var f=function(){'
      + 'var w=document.createTreeWalker(document.body||document.documentElement,4),n,h=[];'
      + 'while((n=w.nextNode()))if(n.textContent.indexOf("InkOS")>-1)h.push(n);'
      + 'for(var i=0;i<h.length;i++)h[i].textContent='
      + 'h[i].textContent.replace(/InkOS Studio/g,"Quire Studio").replace(/InkOS/g,"Quire");};'
      + 'new MutationObserver(f).observe(document.documentElement,{childList:true,subtree:true,characterData:true});'
      + 'document.addEventListener("DOMContentLoaded",f);})();<\/script>';

    html = html.replace("</head>", [
      "    " + early,
      `    <link rel="stylesheet" href="/assets/quire-patch.css?v=${v}">`,
      `    <link rel="stylesheet" href="/assets/quire-mag.css?v=${v}">`,
      `    <script src="/assets/quire-patch.js?v=${v}" defer></script>`,
      `    <script src="/assets/quire-mag.js?v=${v}" defer></script>`,
      "  </head>",
    ].join("\n"));
    writeFileSync(indexHtml, html);
    console.log("studio patch installed (panels, English, progress, magazine)");
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
// Studio deliberately ignores INKOS_LLM_* from the environment (inkos-core:
// effective-llm-config warns about exactly this), so the model the settings
// drawer saves would never reach it. Its own import-env route converts that
// env into the `services` entry Studio does read — poke it once it is up, or
// the workbench sits behind "Set up models" with no provider at all.
(async () => {
  const url = `http://127.0.0.1:${PORT}`;
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch(`${url}/api/v1/services/config/import-env`, { method: "POST" });
      if (r.ok) return console.log("studio model config synced from ~/.inkos/.env");
      if (r.status === 400) return console.warn("studio config not synced: no importable env");
    } catch {}
    await new Promise((r) => setTimeout(r, 1000));
  }
  console.warn("studio config sync timed out");
})();

child.on("exit", (code) => process.exit(code ?? 0));
child.on("error", (e) => {
  console.error("failed to start studio: " + e.message);
  process.exit(1);
});
