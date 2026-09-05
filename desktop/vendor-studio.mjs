// Builds the Quire fork of InkOS in vendor/studio and stages a *runtime-only* copy into
// cli-shim/studio, which Tauri already ships as a resource. Quire no longer
// needs `npm i -g @actalk/inkos` on the user's machine.
//
// Why not `pnpm deploy --prod`: Studio lists its client build tooling
// (mermaid, streamdown, lucide-react, shadcn, typescript, msw) under
// `dependencies`, so a prod deploy comes to 1.8 GB / 224k files. None of it
// runs at runtime — the client is already compiled into studio/dist. The
// server half imports exactly three packages, so this stages those instead.
import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, "..");
const SRC = join(REPO, "vendor", "studio");
const OUT = join(REPO, "cli-shim", "engine");

if (!existsSync(join(SRC, "package.json"))) {
  console.error("vendor/studio is missing — run: git submodule update --init --recursive");
  process.exit(1);
}

// CI=true so pnpm may purge a node_modules that no longer matches its path
// without asking. Moving the checkout - vendor/inkos to vendor/studio, say -
// invalidates the store links inside it, and pnpm then refuses to continue
// because there is no TTY to confirm the removal on.
const sh = (cmd, args, cwd) =>
  execFileSync(cmd, args, {
    cwd,
    stdio: "inherit",
    shell: process.platform === "win32",
    env: { ...process.env, CI: "true" },
  });

const skipBuild = process.argv.includes("--no-build");
if (!skipBuild) {
  console.log("building the fork…");
  sh("pnpm", ["install", "--frozen-lockfile"], SRC);
  /*
   * The client is bundled by vite, which does not type-check. A React file
   * referring to a name that is not in its scope therefore built cleanly,
   * shipped, and blanked the whole window on render — the error existed only
   * at runtime, in front of the user, with nothing on the way there to catch
   * it. `pnpm build` alone is not a gate; this is.
   */
  /*
   * Core first, and not because the build order is pretty.
   *
   * The studio resolves `@actalk/quire-core` to the workspace package, whose
   * types are `dist/index.d.ts` — a file that does not exist until core is
   * built. On a developer's machine it is always there from some earlier run,
   * so the type-check below passes; on a clean checkout it is not, every import
   * of the engine fails to resolve, and the release build dies. That is exactly
   * how v0.1.24 failed: this gate ran before the thing it type-checks against
   * existed.
   */
  console.log("building the engine…");
  sh("pnpm", ["--filter", "@actalk/quire-core", "build"], SRC);
  console.log("type-checking the client…");
  sh("pnpm", ["--filter", "@actalk/quire-studio", "typecheck"], SRC);
  sh("pnpm", ["build"], SRC);
}

const studioDist = join(SRC, "packages", "studio", "dist");
const coreDist = join(SRC, "packages", "core", "dist");
if (!existsSync(join(studioDist, "api", "index.js"))) {
  console.error("studio dist missing — the fork did not build");
  process.exit(1);
}

/**
 * Remove a staged tree, allowing for Windows.
 *
 * A plain rmSync fails with EBUSY whenever anything still holds a file under
 * it — a running Studio above all, but a just-exited one too, because handles
 * and virus scanners release on their own schedule. Node's own retry options
 * exist for exactly this.
 */
function removeTree(dir, what) {
  if (!existsSync(dir)) return;
  try {
    rmSync(dir, { recursive: true, force: true, maxRetries: 12, retryDelay: 250 });
  } catch (error) {
    if (error?.code !== "EBUSY" && error?.code !== "EPERM" && error?.code !== "ENOTEMPTY") throw error;
    console.error(
      `\ncannot replace ${what}: something is still using it.\n`
      + `  ${error.path || dir}\n\n`
      + "Quire is probably running. Stop it and run this again — staging over a\n"
      + "live install is what leaves the app serving half of one build and half\n"
      + "of another.\n",
    );
    process.exit(1);
  }
}

// Staged beside the target and swapped in at the end. A failure halfway used
// to leave cli-shim/studio partly deleted, which the shim will still happily
// launch: the app then runs a mix of two builds and looks like a code bug
// rather than a staging one.
const STAGE = OUT + ".staging";

console.log("staging runtime into cli-shim/studio…");
removeTree(STAGE, "the previous staging directory");
mkdirSync(STAGE, { recursive: true });

// 1. The compiled Studio, server and client both.
cpSync(studioDist, join(STAGE, "studio", "dist"), { recursive: true });

// 2. The workspace bootstrap the shim calls before launching Studio. It goes
// under dist/ so `import("dist/project-bootstrap.js")` resolves identically
// whether the shim found this staged runtime or a global npm install.
mkdirSync(join(STAGE, "dist"), { recursive: true });
for (const f of ["project-bootstrap.js", "utils.js"]) {
  cpSync(join(SRC, "packages", "cli", "dist", f), join(STAGE, "dist", f));
}

// 3. The runtime package.json. core's own dependencies are declared here, at
// the root, so both core and Studio resolve them by walking up.
const corePkg = JSON.parse(readFileSync(join(SRC, "packages", "core", "package.json"), "utf8"));
const studioPkg = JSON.parse(readFileSync(join(SRC, "packages", "studio", "package.json"), "utf8"));
const need = (name) => {
  const v = studioPkg.dependencies?.[name];
  if (!v) throw new Error(`studio no longer depends on ${name} — update this script`);
  return v;
};
writeFileSync(join(STAGE, "package.json"), JSON.stringify({
  name: "quire-inkos-runtime",
  version: studioPkg.version,
  private: true,
  type: "module",
  // Only what dist/api actually imports. Verified with:
  //   grep -rhoE 'from "[^".][^"]*"' packages/studio/dist/{api,lib,shared}
  dependencies: {
    ...corePkg.dependencies,
    hono: need("hono"),
    "@hono/node-server": need("@hono/node-server"),
  },
}, null, 2));

// npm, not pnpm: the staged tree is copied into an installer, and pnpm's
// symlinked store does not survive that.
console.log("installing runtime dependencies…");
sh("npm", ["install", "--omit=dev", "--no-audit", "--no-fund", "--install-strategy=hoisted"], STAGE);

// 4. quire-core, staged AFTER npm: it is not a registry dependency, so an
// npm install run afterwards prunes it as extraneous and Studio then dies
// with ERR_MODULE_NOT_FOUND '@actalk/quire-core'. Its own dependencies are
// in the root package.json above, so Node resolves them by walking up.
const coreOut = join(STAGE, "node_modules", "@actalk", corePkg.name.split("/")[1]);
mkdirSync(coreOut, { recursive: true });
cpSync(coreDist, join(coreOut, "dist"), { recursive: true });
// core's package.json ships "files": ["dist","genres","skills","publications"]
// - the builtin skills, genre profiles and publication definitions are data
// files, not compiled output.
// Copying only dist left the skills API returning 500 on every request:
// ENOENT stat .../inkos-core/skills.
for (const data of ["skills", "genres", "publications"]) {
  cpSync(join(SRC, "packages", "core", data), join(coreOut, data), { recursive: true });
}
writeFileSync(join(coreOut, "package.json"), JSON.stringify({
  name: corePkg.name, version: corePkg.version, type: corePkg.type,
  main: corePkg.main, module: corePkg.module, types: corePkg.types,
  exports: corePkg.exports, dependencies: corePkg.dependencies,
}, null, 2));


/**
 * Move the staged tree into place without moving the tree.
 *
 * Neither deleting nor renaming cli-shim/studio is reliable on Windows: any
 * shell whose working directory sits inside it, and any handle not yet
 * released by an exited process, makes both fail — and a failed delete used to
 * leave the app with half a runtime, which then looks like a code bug. Copying
 * over the top always works, because it never needs the directory itself.
 *
 * Files the new build no longer has are removed afterwards, so a module that
 * was deleted upstream does not keep answering imports. That pass is
 * best-effort: a file still open is stale but harmless, while failing the
 * whole stage over it is not.
 */
function syncInto(from, to) {
  cpSync(from, to, { recursive: true, force: true });

  const relFiles = (root) => {
    const out = new Set();
    const walk = (dir, prefix) => {
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        const rel = prefix ? `${prefix}/${e.name}` : e.name;
        if (e.isDirectory()) walk(join(dir, e.name), rel);
        else out.add(rel);
      }
    };
    walk(root, "");
    return out;
  };

  const wanted = relFiles(from);
  let stale = 0;
  for (const rel of relFiles(to)) {
    if (wanted.has(rel)) continue;
    try { rmSync(join(to, ...rel.split("/")), { force: true }); stale++; } catch {}
  }
  if (stale) console.log(`removed ${stale} file(s) the new build no longer has`);
}

syncInto(STAGE, OUT);
removeTree(STAGE, "the staging directory");

const size = (dir) => {
  let bytes = 0;
  const walk = (d) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, e.name);
      if (e.isDirectory()) walk(p);
      else bytes += statSync(p).size;
    }
  };
  walk(dir);
  return bytes;
};
console.log(`staged ${(size(OUT) / 1048576).toFixed(1)} MB into cli-shim/engine`);
