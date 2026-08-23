#!/usr/bin/env node
// quire — one command for the whole stack: model shim + InkOS Studio.
// Spawns both, waits for their ports, opens a browser, and guarantees both die
// together. Phase 3 (desktop shell) reuses this file's supervise() as-is.
import { spawn } from "node:child_process";
import { createConnection } from "node:net";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const SHIM_PORT = Number(process.env.SHIM_PORT || 8787);
const STUDIO_PORT = Number(process.env.STUDIO_PORT || 4567);
const OPEN = !process.argv.includes("--no-open");
const CWD = process.env.INKOS_PROJECT || HERE;

const log = (tag, msg) => console.log(`[${tag}] ${msg}`);

const portOpen = (port) => new Promise((resolve) => {
  const s = createConnection({ port, host: "127.0.0.1" });
  const done = (v) => { s.destroy(); resolve(v); };
  s.once("connect", () => done(true));
  s.once("error", () => done(false));
  setTimeout(() => done(false), 1000);
});

async function waitForPort(port, name, timeoutMs = 90000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await portOpen(port)) return true;
    await new Promise((r) => setTimeout(r, 400));
  }
  throw new Error(`${name} did not open port ${port} within ${timeoutMs}ms`);
}

const children = [];

function supervise(name, cmd, args, opts = {}) {
  const child = spawn(cmd, args, {
    cwd: opts.cwd || HERE,
    env: { ...process.env, ...opts.env },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
    // Node >=20 on Windows refuses to spawn a .cmd/.bat shim directly (EINVAL);
    // those need a shell. Real .exe paths must NOT use one, or quoting breaks.
    shell: opts.shell === true,
    // Own process group so one Ctrl+C in this terminal does not race us to the
    // children — shutdown() is the single path that kills them.
    detached: false,
  });
  children.push({ name, child });
  const pipe = (stream) => {
    stream.setEncoding("utf8");
    let buf = "";
    stream.on("data", (c) => {
      buf += c;
      for (let nl; (nl = buf.indexOf("\n")) >= 0;) {
        const line = buf.slice(0, nl).trimEnd();
        buf = buf.slice(nl + 1);
        if (line && !/ExperimentalWarning|DeprecationWarning|--trace-warnings/.test(line)) {
          log(name, line);
        }
      }
    });
  };
  pipe(child.stdout);
  pipe(child.stderr);
  child.on("exit", (code, signal) => {
    if (shuttingDown) return;
    log(name, `exited (code=${code} signal=${signal})`);
    shutdown(code ?? 1);
  });
  child.on("error", (e) => {
    log(name, `spawn failed: ${e.message}`);
    shutdown(1);
  });
  return child;
}

let shuttingDown = false;
function shutdown(code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const { name, child } of children) {
    if (child.exitCode !== null || child.killed) continue;
    log("quire", `stopping ${name} (pid ${child.pid})`);
    try {
      // taskkill /T is the only reliable way to reap a Windows process tree;
      // SIGTERM on the parent leaves node/cli grandchildren holding the port.
      if (process.platform === "win32") {
        spawn("taskkill", ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore", windowsHide: true });
      } else {
        child.kill("SIGTERM");
      }
    } catch {}
  }
  setTimeout(() => process.exit(code), 800);
}

for (const sig of ["SIGINT", "SIGTERM", "SIGHUP"]) process.on(sig, () => shutdown(0));
process.on("exit", () => { if (!shuttingDown) shutdown(0); });

function openBrowser(url) {
  const [cmd, args] = process.platform === "win32"
    ? ["cmd", ["/c", "start", "", url]]
    : process.platform === "darwin" ? ["open", [url]] : ["xdg-open", [url]];
  try { spawn(cmd, args, { stdio: "ignore", detached: true, windowsHide: true }).unref(); } catch {}
}

// A chromeless app window. Chromium's --app mode gives a real OS window with no
// tabs or address bar, using a dedicated profile so it does not inherit or
// disturb the user's normal browsing session. Falls back to a plain tab.
const CHROME_CANDIDATES = process.platform === "win32"
  ? [join(process.env["PROGRAMFILES"] || "", "Google/Chrome/Application/chrome.exe"),
     join(process.env["PROGRAMFILES(X86)"] || "", "Google/Chrome/Application/chrome.exe"),
     join(process.env.LOCALAPPDATA || "", "Google/Chrome/Application/chrome.exe"),
     join(process.env.LOCALAPPDATA || "", "Microsoft/Edge/Application/msedge.exe")]
  : process.platform === "darwin"
    ? ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"]
    : ["/usr/bin/google-chrome", "/usr/bin/chromium", "/usr/bin/microsoft-edge"];

function openAppWindow(url, { width = 1280, height = 860 } = {}) {
  const bin = CHROME_CANDIDATES.find((p) => p && existsSync(p));
  if (!bin) {
    log("quire", "no Chromium found — opening in default browser");
    openBrowser(url);
    return;
  }
  const child = spawn(bin, [
    `--app=${url}`,
    `--user-data-dir=${join(HERE, ".window-profile")}`,
    `--window-size=${width},${height}`,
    "--no-first-run", "--no-default-browser-check",
  ], { stdio: "ignore", detached: true, windowsHide: true });

  // A detached spawn reports failure asynchronously, so returning "true" right
  // after the call would claim a window that never opened. Wait for the verdict.
  child.on("error", (e) => {
    log("quire", `window failed (${e.message}) — falling back to browser`);
    openBrowser(url);
  });
  child.once("spawn", () => {
    log("quire", `desktop window opened (pid ${child.pid})`);
    child.unref();
  });
}

(async () => {
  log("quire", "starting model shim + InkOS Studio");

  if (await portOpen(SHIM_PORT)) {
    log("quire", `port ${SHIM_PORT} already in use — reusing whatever is there`);
  } else {
    supervise("shim", process.execPath, [join(HERE, "cli-shim", "server.mjs")],
      { env: { SHIM_PORT: String(SHIM_PORT), STUDIO_PORT: String(STUDIO_PORT) } });
    await waitForPort(SHIM_PORT, "shim");
  }

  // Report what the shim actually found, so a missing CLI is visible at boot
  // instead of surfacing later as a confusing 400 mid-chapter.
  try {
    const s = await fetch(`http://127.0.0.1:${SHIM_PORT}/status`).then((r) => r.json());
    for (const a of s.agents) log("shim", `${a.id} ${a.version} — ${a.models} models`);
    log("shim", `${s.total} models total, lang=${s.lang}`);
  } catch (e) {
    log("shim", `status probe failed: ${e.message}`);
  }

  if (await portOpen(STUDIO_PORT)) {
    log("quire", `port ${STUDIO_PORT} already in use — reusing whatever is there`);
  } else {
    const win = process.platform === "win32";
    supervise("studio", win ? "inkos.cmd" : "inkos",
      ["studio", "--port", String(STUDIO_PORT)], { cwd: CWD, shell: win });
    await waitForPort(STUDIO_PORT, "studio");
  }

  const studioUrl = `http://localhost:${STUDIO_PORT}`;
  const panelUrl = `http://127.0.0.1:${SHIM_PORT}/`;
  log("quire", `control panel — ${panelUrl}`);
  log("quire", `studio        — ${studioUrl}`);
  log("quire", "Ctrl+C stops both servers");
  if (OPEN) openAppWindow(panelUrl, { width: 1120, height: 820 });
})().catch((e) => {
  log("quire", `fatal: ${e.message}`);
  shutdown(1);
});
