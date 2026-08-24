// Builds the InkOS fork in vendor/inkos and stages a *runtime-only* copy into
// cli-shim/inkos, which Tauri already ships as a resource. Quire no longer
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
const SRC = join(REPO, "vendor", "inkos");
const OUT = join(REPO, "cli-shim", "inkos");

if (!existsSync(join(SRC, "package.json"))) {
  console.error("vendor/inkos is missing — run: git submodule update --init --recursive");
  process.exit(1);
}

const sh = (cmd, args, cwd) =>
  execFileSync(cmd, args, { cwd, stdio: "inherit", shell: process.platform === "win32" });

const skipBuild = process.argv.includes("--no-build");
if (!skipBuild) {
  console.log("building the fork…");
  sh("pnpm", ["install", "--frozen-lockfile"], SRC);
  sh("pnpm", ["build"], SRC);
}

const studioDist = join(SRC, "packages", "studio", "dist");
const coreDist = join(SRC, "packages", "core", "dist");
if (!existsSync(join(studioDist, "api", "index.js"))) {
  console.error("studio dist missing — the fork did not build");
  process.exit(1);
}

console.log("staging runtime into cli-shim/inkos…");
rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

// 1. The compiled Studio, server and client both.
cpSync(studioDist, join(OUT, "studio", "dist"), { recursive: true });

// 2. The workspace bootstrap the shim calls before launching Studio. It goes
// under dist/ so `import("dist/project-bootstrap.js")` resolves identically
// whether the shim found this staged runtime or a global npm install.
mkdirSync(join(OUT, "dist"), { recursive: true });
for (const f of ["project-bootstrap.js", "utils.js"]) {
  cpSync(join(SRC, "packages", "cli", "dist", f), join(OUT, "dist", f));
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
writeFileSync(join(OUT, "package.json"), JSON.stringify({
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
sh("npm", ["install", "--omit=dev", "--no-audit", "--no-fund", "--install-strategy=hoisted"], OUT);

// 4. inkos-core, staged AFTER npm: it is not a registry dependency, so an
// npm install run afterwards prunes it as extraneous and Studio then dies
// with ERR_MODULE_NOT_FOUND '@actalk/inkos-core'. Its own dependencies are
// in the root package.json above, so Node resolves them by walking up.
const coreOut = join(OUT, "node_modules", "@actalk", "inkos-core");
mkdirSync(coreOut, { recursive: true });
cpSync(coreDist, join(coreOut, "dist"), { recursive: true });
// core's package.json ships "files": ["dist", "genres", "skills"] - the
// builtin skills and genre profiles are data files, not compiled output.
// Copying only dist left the skills API returning 500 on every request:
// ENOENT stat .../inkos-core/skills.
for (const data of ["skills", "genres"]) {
  cpSync(join(SRC, "packages", "core", data), join(coreOut, data), { recursive: true });
}
writeFileSync(join(coreOut, "package.json"), JSON.stringify({
  name: corePkg.name, version: corePkg.version, type: corePkg.type,
  main: corePkg.main, module: corePkg.module, types: corePkg.types,
  exports: corePkg.exports, dependencies: corePkg.dependencies,
}, null, 2));


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
console.log(`staged ${(size(OUT) / 1048576).toFixed(1)} MB into cli-shim/inkos`);
