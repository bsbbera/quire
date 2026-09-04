/**
 * Drive a running Quire over its HTTP API.
 *
 * Testing this app has meant hand-written curl against a port number recalled
 * from memory, and getting the build wrong means "verifying" a fix against the
 * other install entirely — which has happened. Name the stage, not the port.
 *
 *   node quire-ctl.mjs dev  /api/v1/build
 *   node quire-ctl.mjs prod /api/v1/audit/projects
 *   node quire-ctl.mjs dev  /api/v1/audit/run '{"path":"..."}'
 *
 * A path starting /api goes to Studio; anything else goes to the model shim.
 *
 * Four verbs sit beside the request form, for the part a request cannot do:
 * start the build, stop it, ask whether it is up, and take a turn of chat
 * (which is two calls - a session, then the instruction - and so was being
 * hand-rolled every time).
 *
 *   node quire-ctl.mjs dev  up
 *   node quire-ctl.mjs dev  status
 *   node quire-ctl.mjs dev  chat "write me a paragraph"
 *   node quire-ctl.mjs dev  down
 *
 * Under Git Bash, prefix with MSYS_NO_PATHCONV=1 or the leading slash is
 * rewritten to a Windows path before this script ever sees it.
 */
import { spawn, execSync } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const PORTS = {
  dev: { studio: 4568, shim: 8788 },
  prod: { studio: 4567, shim: 8787 },
};

const [stage, path, ...rest] = process.argv.slice(2);
const body = rest.join(" ") || undefined;
if (!PORTS[stage] || !path) {
  console.error("usage: node quire-ctl.mjs <dev|prod> <path|up|down|status|chat> [json-body|text]");
  process.exit(2);
}

const ROOT = join(homedir(), "IDEAVERSE", stage === "dev" ? "Quire-Dev" : "Quire-Prod");
const api = (p) => `http://127.0.0.1:${PORTS[stage].studio}${p}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Answering at all. A refused connection is down; anything else is up. */
async function answering(port, path = "/") {
  try {
    await fetch(`http://127.0.0.1:${port}${path}`, { signal: AbortSignal.timeout(1500) });
    return true;
  } catch (e) {
    return !/ECONNREFUSED|fetch failed/i.test(String(e?.cause?.code ?? e?.message ?? e));
  }
}

/**
 * Both halves, not just Studio.
 *
 * This asked only about Studio's port, so a dead shim reported "dev up on
 * 4568" while every model in the app was unreachable — the screen loaded,
 * nothing could answer, and the check said healthy. The shim is where models
 * live; a build with no shim is not up.
 */
async function isUp() {
  return (await answering(PORTS[stage].studio)) && (await answering(PORTS[stage].shim, "/v1/status"));
}

/** The PIDs on this stage's ports, so `down` stops this build and not the other. */
function holders() {
  try {
    return [...new Set(
      execSync("netstat -ano -p tcp", { encoding: "utf8" })
        .split("\n")
        .filter((l) => l.includes("LISTENING")
          && (l.includes(`:${PORTS[stage].studio} `) || l.includes(`:${PORTS[stage].shim} `)))
        .map((l) => l.trim().split(/\s+/).pop())
        .filter((pid) => pid && pid !== "0"),
    )];
  } catch { return []; }
}

/** This stage's window, told from the other's by where it was launched from. */
function appPids() {
  try {
    // The root goes through the environment, not the command string: a path is
    // the one argument here that could contain a quote.
    const ps = `Get-CimInstance Win32_Process -Filter "name='quire.exe'"`
      + ` | Where-Object { $_.ExecutablePath -like ($env:QROOT + '*') }`
      + ` | ForEach-Object { $_.ProcessId }`;
    return execSync(`powershell -NoProfile -Command ${JSON.stringify(ps)}`,
      { encoding: "utf8", env: { ...process.env, QROOT: ROOT } })
      .split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  } catch { return []; }
}

/** A model call runs for minutes; only the probes above are given a deadline. */
async function call(method, p, payload) {
  const res = await fetch(api(p), {
    method,
    ...(payload === undefined ? {} : {
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    }),
    signal: AbortSignal.timeout(900_000),
  });
  const text = await res.text();
  // Studio serves its own SPA on anything it does not route, so a mistyped
  // path answers 200 with an HTML page. That is a miss wearing a success code.
  if (/^\s*<(!doctype|html)/i.test(text)) {
    console.error(`${method} ${p} is not an API route — the SPA answered`);
    process.exit(1);
  }
  if (!res.ok) { console.error(`${method} ${p} -> ${res.status}\n${text}`); process.exit(1); }
  try { return JSON.parse(text); } catch { return text; }
}

const VERBS = {
  async status() {
    const up = await isUp();
    const out = { stage, root: ROOT, ...PORTS[stage], up };
    if (up) {
      out.build = await call("GET", "/api/v1/build");
      out.model = await call("GET", "/api/v1/project/default-model");
    }
    console.log(JSON.stringify(out, null, 2));
  },

  async up() {
    if (await isUp()) return console.log(`${stage} already up on ${PORTS[stage].studio}`);
    const exe = join(ROOT, "quire.exe");
    if (!existsSync(exe)) { console.error(`no quire.exe at ${exe}`); process.exit(1); }
    spawn(exe, [], { cwd: ROOT, detached: true, stdio: "ignore" }).unref();
    for (let i = 0; i < 120; i += 1) {
      await sleep(1000);
      if (await isUp()) return console.log(`${stage} up on ${PORTS[stage].studio} after ${i + 1}s`);
    }
    console.error(`${stage} did not answer within 120s`);
    process.exit(1);
  },

  down() {
    // The window as well as the servers. Killing only what holds the ports
    // leaves the shell alive with dead children: it does not restart them, and
    // single-instance then makes the next `up` focus that corpse instead of
    // booting a new one, so the build looks permanently down.
    const pids = new Set(holders());
    for (const pid of appPids()) pids.add(pid);
    if (!pids.size) return console.log(`${stage} not running`);
    for (const pid of pids) { try { execSync(`taskkill /PID ${pid} /T /F`, { stdio: "ignore" }); } catch {} }
    console.log(`stopped ${stage}: ${[...pids].join(", ")}`);
  },

  /** A turn of chat: a session to hold it, then the instruction. */
  async chat() {
    if (!body?.trim()) { console.error("chat needs something to say"); process.exit(2); }
    const { session } = await call("POST", "/api/v1/sessions", {});
    console.error(`session ${session.sessionId}`);
    const t0 = Date.now();
    const out = await call("POST", "/api/v1/agent", { instruction: body, sessionId: session.sessionId });
    console.error(`${Math.round((Date.now() - t0) / 1000)}s`);
    console.log(typeof out === "string" ? out : (out.response ?? JSON.stringify(out, null, 2)));
  },
};

if (VERBS[path]) {
  await VERBS[path]();
  process.exit(0);
}

const port = path.startsWith("/api") ? PORTS[stage].studio : PORTS[stage].shim;
const url = `http://127.0.0.1:${port}${path}`;

const res = await fetch(url, body
  ? { method: "POST", headers: { "content-type": "application/json" }, body }
  : {}).catch((err) => {
    // A refused connection means that build is not running — worth saying
    // plainly, since the alternative reading is "the endpoint is broken".
    console.error(`${stage} is not answering on :${port} — is it running? (${err.message})`);
    process.exit(1);
  });

const text = await res.text();
console.error(`${res.status} ${res.statusText}  ${url}`);
try { console.log(JSON.stringify(JSON.parse(text), null, 2)); }
catch { console.log(text); }
if (!res.ok) process.exit(1);
