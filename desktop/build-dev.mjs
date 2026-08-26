// Builds the side-by-side development copy: "Quire Dev", its own identifier,
// its own install directory, its own ports.
//
// The ports have to be set here rather than in tauri.dev.conf.json because
// main.rs bakes them in at compile time (option_env!). They must stay in sync
// with the CSP in tauri.dev.conf.json, which names the same two ports.
import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const env = { ...process.env, QUIRE_SHIM_PORT: "8788", QUIRE_STUDIO_PORT: "4568" };

for (const step of [
  ["node", ["vendor-inkos.mjs"]],
  ["node", ["clean-resources.mjs"]],
  // --no-bundle: the dev copy is deployed by copying the build output, not by
  // running an installer. Tauri's NSIS installer silently declines to replace
  // an install of the same version, so a dev build appeared to install (exit
  // 0) while the old binary stayed in place — and everything "verified"
  // afterwards was really the previous build. Copying cannot fail that way,
  // and it skips a minute of packaging per iteration.
  ["npx", ["tauri", "build", "--no-bundle", "--config", "src-tauri/tauri.dev.conf.json"]],
]) {
  execFileSync(step[0], step[1], { cwd: HERE, stdio: "inherit", env, shell: process.platform === "win32" });
}

const built = join(HERE, "src-tauri", "target", "release");
const dest = join(homedir(), "AppData", "Local", "Quire-Dev");
if (!existsSync(join(built, "quire.exe"))) {
  console.error("build produced no quire.exe");
  process.exit(1);
}
// The staged runtime must be present, or the app starts and Studio never does.
if (!existsSync(join(built, "cli-shim", "inkos", "studio", "dist", "api", "index.js"))) {
  console.error("cli-shim/inkos is missing from the build output");
  process.exit(1);
}
// A running Quire-Dev holds cli-shim open and rmSync fails with a raw EBUSY
// stack. Say what to do instead of dumping the stack.
try {
  rmSync(join(dest, "cli-shim"), { recursive: true, force: true });
} catch (err) {
  if (err.code === "EBUSY") {
    console.error(`cannot replace ${join(dest, "cli-shim")} — Quire-Dev is still running.`);
    console.error("Close it (or: Get-Process quire | Stop-Process -Force) and re-run.");
    process.exit(1);
  }
  throw err;
}
mkdirSync(dest, { recursive: true });
cpSync(join(built, "quire.exe"), join(dest, "quire.exe"));
cpSync(join(built, "cli-shim"), join(dest, "cli-shim"), { recursive: true });

// cli-shim/studio.mjs reads a .env one level above itself, which in the repo
// is Quire-Dev/.env and in the install is this directory. Nothing put one
// here, so search keys reached a dev run and never the installed app: a
// magazine got as far as research and refused to invent its sources.
// Gitignored at the source and the install is not a repo, so the key stays
// out of version control either way.
const envFile = join(HERE, "..", ".env");
if (existsSync(envFile)) {
  cpSync(envFile, join(dest, ".env"));
  console.log("copied .env (search and machine-local keys)");
}
// --no-bundle skips the NSIS installer, so nothing registers Quire-Dev with
// Windows: no Start Menu entry, no desktop icon, no way to launch it without
// knowing this path. Write the two shortcuts the installer would have.
const shortcuts = [
  join(homedir(), "OneDrive", "Desktop", "Quire-Dev.lnk"),
  join(homedir(), "AppData", "Roaming", "Microsoft", "Windows", "Start Menu", "Programs", "Quire-Dev.lnk"),
];
if (process.platform === "win32") {
  const exe = join(dest, "quire.exe");
  const ps = shortcuts
    .filter((p) => existsSync(dirname(p)))
    .map((p) => `$s=$w.CreateShortcut('${p}');$s.TargetPath='${exe}';`
      + `$s.WorkingDirectory='${dest}';`
      + `$s.Description='Quire-Dev (development build, ports 8788/4568)';$s.Save();`)
    .join("");
  try {
    execFileSync("powershell", ["-NoProfile", "-Command", `$w=New-Object -ComObject WScript.Shell;${ps}`], { stdio: "ignore" });
    console.log(`shortcuts: ${shortcuts.join(", ")}`);
  } catch {
    console.warn("could not create Quire-Dev shortcuts");
  }
}
console.log(`deployed to ${dest}`);
