// Where Quire keeps your work.
//
// The root used to be computed independently in three places (server.mjs,
// studio.mjs, workflows.mjs) from the same env-or-~/Quire-or-~/InkDesk
// expression, and there was no way to change it from inside the app: you set
// QUIRE_WORKSPACE in the environment before launch or you lived in ~/Quire.
// This owns the answer, and can write it down.
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync, accessSync, constants } from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";

const HOME = homedir();

// Deliberately NOT inside the workspace: the file that says where the
// workspace is cannot live in it.
const CONFIG_DIR = join(HOME, ".quire");
const CONFIG = join(CONFIG_DIR, "workspace.json");

/** The two names a workspace has had. An existing ~/InkDesk holds real books,
 *  so the rename to Quire must not silently start empty under the new name. */
const LEGACY = [join(HOME, "Quire"), join(HOME, "InkDesk")];

function readConfig() {
  try { return JSON.parse(readFileSync(CONFIG, "utf-8")); } catch { return {}; }
}

/**
 * The workspace root, in precedence order:
 *   1. what the user picked in Settings
 *   2. QUIRE_WORKSPACE
 *   3. an existing ~/Quire or ~/InkDesk
 *   4. ~/Quire
 *
 * The saved choice beats the env var on purpose. The env var is inherited by
 * every child from whatever shell launched the app, so if it lost, a stale
 * export would silently undo a folder the user had just picked and confirmed.
 */
export function root() {
  const saved = readConfig().path;
  if (typeof saved === "string" && saved.trim() && isAbsolute(saved)) return resolve(saved);
  if (process.env.QUIRE_WORKSPACE) return resolve(process.env.QUIRE_WORKSPACE);
  return LEGACY.find(existsSync) || LEGACY[0];
}

/**
 * True once `inkos.json` is there — the marker the CLI's own bootstrap writes.
 *
 * This is the whole signal. A count of books used to sit beside it and read 0
 * on a workspace holding a finished magazine, four worlds and a storyboard,
 * because only `books/` was counted; enumerating every kind of work instead
 * would be a list that goes stale every time Quire learns a new one.
 */
const initialized = (p) => existsSync(join(p, "inkos.json"));

function writable(p) {
  try { accessSync(p, constants.W_OK); return true; } catch { return false; }
}

/**
 * What a candidate folder is, so the UI can say what will happen before the
 * user commits to it rather than after the restart.
 */
export function inspect(path = root()) {
  const p = resolve(path);
  const out = {
    path: p,
    default: LEGACY[0],
    // Only the folder actually in use has a source. A candidate the user is
    // still looking at has not come from anywhere yet, and saying it was "set
    // by an environment variable" would be a lie about a folder they picked.
    source: p !== root() ? null
      : readConfig().path ? "chosen"
      : process.env.QUIRE_WORKSPACE ? "environment" : "default",
    exists: existsSync(p),
    isDir: false,
    initialized: false,
    writable: false,
  };
  if (!out.exists) {
    // A folder that does not exist yet is fine as long as its parent does —
    // that is the difference between "new folder" and "typo".
    out.parentExists = existsSync(dirname(p));
    return out;
  }
  out.isDir = statSync(p).isDirectory();
  if (!out.isDir) return out;
  out.initialized = initialized(p);
  out.writable = writable(p);
  return out;
}

/**
 * Record a new root. Creates the folder if its parent exists; never touches
 * what is in the old one. Moving books is the user's call, not a side effect
 * of changing a setting.
 */
export function set(path) {
  if (typeof path !== "string" || !path.trim()) throw new Error("a folder is required");
  // Checked before resolve(), not after: resolve() makes everything absolute,
  // so a typed relative path would silently land under the shim's own cwd.
  if (!isAbsolute(path.trim())) throw new Error("the folder must be a full path");
  const p = resolve(path.trim());

  if (existsSync(p)) {
    if (!statSync(p).isDirectory()) throw new Error(`${p} is a file, not a folder`);
  } else {
    if (!existsSync(dirname(p))) throw new Error(`${dirname(p)} does not exist`);
    mkdirSync(p, { recursive: true });
  }
  if (!writable(p)) throw new Error(`${p} is not writable`);

  mkdirSync(CONFIG_DIR, { recursive: true });
  writeFileSync(CONFIG, JSON.stringify({ path: p }, null, 2), "utf-8");
  return inspect(p);
}

function run(cmd, args, env) {
  return new Promise((done) => {
    const c = spawn(cmd, args, { env: { ...process.env, ...env }, windowsHide: true });
    let out = "";
    c.stdout.on("data", (d) => { out += d; });
    c.on("error", () => done(null));
    c.on("close", (code) => done(code === 0 ? out.trim() : null));
  });
}

/**
 * The native folder chooser. Async on purpose: the shim is single-threaded, so
 * a synchronous dialog would freeze every other request for as long as the
 * user browsed. Returns null when the user cancels.
 *
 * The starting folder goes through the environment rather than the command
 * string, so a path with a quote in it cannot become part of the script.
 */
export async function pick(start = root()) {
  const prompt = "Choose the folder where Quire keeps your books";
  // A start folder that is not a real directory is worse than none: the
  // dialogs either throw or open somewhere arbitrary. The UI can pass whatever
  // is on screen, including a placeholder, so it is checked here.
  const from = typeof start === "string" && existsSync(start) && statSync(start).isDirectory()
    ? start : "";

  if (process.platform === "win32") {
    // FolderBrowserDialog needs a single-threaded apartment, and without an
    // owner it opens behind the app window.
    const ps = [
      "Add-Type -AssemblyName System.Windows.Forms",
      "$d = New-Object System.Windows.Forms.FolderBrowserDialog",
      `$d.Description = '${prompt}'`,
      "$d.ShowNewFolderButton = $true",
      "if ($env:QUIRE_PICK_START) { $d.SelectedPath = $env:QUIRE_PICK_START }",
      "$o = New-Object System.Windows.Forms.Form",
      "$o.TopMost = $true",
      "if ($d.ShowDialog($o) -eq [System.Windows.Forms.DialogResult]::OK) { [Console]::Out.Write($d.SelectedPath) }",
      "$o.Dispose()",
    ].join("; ");
    const r = await run("powershell", ["-STA", "-NoProfile", "-NonInteractive", "-Command", ps],
      { QUIRE_PICK_START: from });
    return r || null;
  }

  if (process.platform === "darwin") {
    const r = await run("osascript", [
      "-e", `POSIX path of (choose folder with prompt "${prompt}")`,
    ]);
    return r || null;
  }

  const r = await run("zenity", ["--file-selection", "--directory", `--title=${prompt}`]);
  return r || null;
}
