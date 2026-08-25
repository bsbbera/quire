// Minimal MCP client — discovery + stdio JSON-RPC, no SDK.
//
// Every MCP server on this machine is already configured for some other agent
// (Claude Desktop extensions, Claude Code, Codex). Re-declaring them here
// would mean two copies to keep in sync, so the configs are read where they
// already live and merged; ~/.inkos/mcp.json only adds or overrides.
//
// The wire protocol is newline-delimited JSON-RPC 2.0 over stdio. That is the
// whole of it for initialize/tools/list/tools/call, so the SDK buys nothing.
import { spawn } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HOME = homedir();
const OVERRIDES = join(HOME, ".inkos", "mcp.json");

const readJson = (p) => { try { return JSON.parse(readFileSync(p, "utf8")); } catch { return null; } };

/**
 * Pull [mcp_servers.NAME] blocks out of Codex's TOML.
 * ponytail: regex, not a TOML parser — only command/args/env are needed, and
 * Node ships no TOML. Swap to a real parser if anything else must be read.
 */
function codexServers() {
  const text = (() => { try { return readFileSync(join(HOME, ".codex", "config.toml"), "utf8"); } catch { return ""; } })();
  const out = {};
  const re = /^\[mcp_servers\.([A-Za-z0-9_-]+)\]\s*$([\s\S]*?)(?=^\[|\Z)/gm;
  let m;
  while ((m = re.exec(text))) {
    const [, name, block] = m;
    const cmd = /^command\s*=\s*['"](.+?)['"]/m.exec(block);
    if (!cmd) continue;
    const args = /^args\s*=\s*\[([\s\S]*?)\]/m.exec(block);
    out[name] = {
      command: cmd[1],
      args: args ? [...args[1].matchAll(/['"](.*?)['"]/g)].map((a) => a[1]) : [],
      source: "codex",
    };
  }
  return out;
}

/**
 * Claude Desktop ships MCP servers as extensions with their own manifests.
 * A manifest is a template: paths the user chose (allowed directories, API
 * tokens) are left as ${user_config.key} and live in a sibling settings file.
 * Without that substitution the filesystem server starts and immediately dies
 * on a literal "${user_config.allowed_directories}" path.
 */
function extensionServers() {
  const dir = join(HOME, "AppData", "Roaming", "Claude", "Claude Extensions");
  if (!existsSync(dir)) return {};
  const out = {};
  for (const slug of readdirSync(dir)) {
    const base = join(dir, slug);
    const man = readJson(join(base, "manifest.json"));
    const cfg = man?.server?.mcp_config;
    if (!cfg?.command) continue;
    const user = readJson(join(dir + " Settings", slug + ".json"))?.userConfig || {};

    // A ${user_config.x} holding a list expands to one argument per entry, so
    // substitution returns an array and the arg list is flattened after it.
    const swap = (raw) => {
      const s = String(raw).replaceAll("${__dirname}", base).replaceAll("${HOME}", HOME);
      const whole = /^\$\{user_config\.([A-Za-z0-9_]+)\}$/.exec(s);
      if (whole) return user[whole[1]] ?? [];
      return s.replace(/\$\{user_config\.([A-Za-z0-9_]+)\}/g, (m, k) => user[k] ?? m);
    };
    const args = (cfg.args || []).flatMap(swap).map(String);
    out[(man.name || slug).toLowerCase().replace(/[^a-z0-9]+/g, "-")] = {
      command: String(swap(cfg.command)),
      args,
      env: Object.fromEntries(Object.entries(cfg.env || {}).map(([k, v]) => [k, String(swap(v))])),
      cwd: base,
      source: "claude-extension",
      // Anything still unresolved means the user never configured it in Claude.
      needsConfig: [...args, ...Object.values(cfg.env || {}).map(swap)]
        .some((a) => String(a).includes("${user_config.")),
    };
  }
  return out;
}

/**
 * Plain { mcpServers: { name: {command,args,env} } } files, which is what
 * Devin/Windsurf and Claude Desktop both write. Two wrinkles: entries carry
 * their own `disabled` flag, and remote servers are declared with a `url` and
 * no command — nothing here can spawn those, so they are skipped rather than
 * listed as broken.
 */
function jsonConfigServers(path, source) {
  const cfg = readJson(path)?.mcpServers;
  if (!cfg) return {};
  const out = {};
  for (const [rawName, v] of Object.entries(cfg)) {
    if (!v?.command) continue;                       // remote/url server: not stdio
    const name = rawName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    out[name] = {
      command: v.command,
      args: v.args || [],
      env: v.env || {},
      cwd: v.cwd,
      source,
      offByDefault: v.disabled === true,
    };
  }
  return out;
}

const DEVIN = join(HOME, "AppData", "Roaming", "devin", "mcp_config.json");
const DESKTOP = join(HOME, "AppData", "Roaming", "Claude", "claude_desktop_config.json");

/**
 * Servers Quire depends on itself, rather than inheriting from another app.
 *
 * Affinity is the build target, so "is it configured?" is not a question the
 * user should have to answer — the connector reported "unknown MCP server:
 * affinity" whenever discovery came up empty, which reads as a Quire
 * misconfiguration for a condition Quire can resolve. Canva ship the bridge
 * inside the Claude extension; it is a plain stdio server, so it is run
 * directly. Discovery still wins if it finds the same extension, and the
 * override file still wins over both.
 */
/**
 * The servers Quire brings itself, as opposed to the ones it finds.
 *
 * `quire` ships with the app and is always here: it is this repo's own
 * mcp-server.mjs, and it is how Affinity, ComfyUI and the publication store
 * are reachable as tools at all. It used to be handed to each CLI at launch
 * instead, which put its calls inside the CLI's own loop where no gate could
 * reach them; now it is an ordinary server the host connects to and the host
 * executes.
 *
 * `affinity` is Canva's Claude Desktop extension, which is not ours to ship —
 * it is picked up when the user has installed it, and its absence is not a
 * problem, because Quire drives Affinity through its own connector regardless.
 */
function builtinServers() {
  const out = {
    quire: {
      command: process.execPath,
      args: [join(dirname(fileURLToPath(import.meta.url)), "mcp-server.mjs")],
      env: {},
      cwd: dirname(fileURLToPath(import.meta.url)),
      source: "quire",
      bundled: true,
    },
  };

  const bridge = join(
    HOME, "AppData", "Roaming", "Claude", "Claude Extensions",
    "ant.dir.gh.canva.affinity", "server", "index.js",
  );
  if (existsSync(bridge)) {
    out.affinity = {
      command: process.execPath,
      args: [bridge],
      env: { SSE_URL: process.env.AFFINITY_SSE_URL || "http://localhost:6767/sse" },
      cwd: dirname(dirname(bridge)),
      source: "quire",
      bundled: true,
    };
  }
  return out;
}

export function servers() {
  const claude = readJson(join(HOME, ".claude.json"))?.mcpServers || {};
  const merged = {
    ...builtinServers(),
    ...extensionServers(),
    ...jsonConfigServers(DESKTOP, "claude-desktop"),
    ...jsonConfigServers(DEVIN, "devin"),
    ...Object.fromEntries(Object.entries(codexServers())
      // Codex's own sandbox helper is not a tool server anyone here should call.
      .filter(([k]) => k !== "node_repl")),
    ...Object.fromEntries(Object.entries(claude).map(([k, v]) => [k, { ...v, source: "claude-code" }])),
    ...(readJson(OVERRIDES)?.mcpServers || {}),
  };
  // A server the source app switched off stays off here, but the override file
  // can turn it back on — otherwise a Devin-disabled server would be
  // unreachable from Quire with no way to say otherwise.
  const ov = readJson(OVERRIDES) || {};
  const disabled = new Set(ov.disabled || []);
  const enabled = new Set(ov.enabled || []);
  for (const [k, v] of Object.entries(merged)) {
    v.enabled = enabled.has(k) || (!disabled.has(k) && !v.offByDefault);
  }
  return merged;
}

// ------------------------------------------------------------------ session
const sessions = new Map(); // name -> { proc, pending, buf, tools, nextId }

function open(name) {
  const cfg = servers()[name];
  if (!cfg) throw new Error("unknown MCP server: " + name);
  if (!cfg.enabled) throw new Error("MCP server disabled: " + name);

  // uvx/npx are .cmd shims on Windows and only resolve through the shell - but
  // the shell then re-splits on spaces, and these paths live under
  // "Claude Extensions". Quote anything with a space when the shell is in play.
  const shell = process.platform === "win32" && !/\.exe$/i.test(cfg.command);
  const q = (s) => (shell && /[ &()]/.test(s) && !s.startsWith('"') ? `"${s}"` : s);
  const proc = spawn(q(cfg.command), (cfg.args || []).map(q), {
    cwd: cfg.cwd, env: { ...process.env, ...(cfg.env || {}) },
    stdio: ["pipe", "pipe", "pipe"],
    shell,
  });

  const s = { proc, pending: new Map(), buf: "", nextId: 1, tools: null, stderr: "" };
  proc.stdout.on("data", (d) => {
    s.buf += d;
    let i;
    while ((i = s.buf.indexOf("\n")) >= 0) {
      const line = s.buf.slice(0, i).trim();
      s.buf = s.buf.slice(i + 1);
      if (!line) continue;
      let msg; try { msg = JSON.parse(line); } catch { continue; }
      const p = s.pending.get(msg.id);
      if (!p) continue; // server-initiated notification: nothing here handles those
      s.pending.delete(msg.id);
      msg.error ? p.reject(new Error(msg.error.message || JSON.stringify(msg.error))) : p.resolve(msg.result);
    }
  });
  // Keep the tail of stderr: MCP servers report config errors there and die
  // silently otherwise, which is impossible to diagnose from a timeout alone.
  proc.stderr.on("data", (d) => { s.stderr = (s.stderr + d).slice(-2000); });
  const die = (why) => {
    for (const p of s.pending.values()) p.reject(new Error(why + (s.stderr ? "\n" + s.stderr : "")));
    s.pending.clear();
    sessions.delete(name);
  };
  proc.on("exit", (c) => die(`MCP server ${name} exited (${c})`));
  proc.on("error", (e) => die(`MCP server ${name} failed to start: ${e.message}`));
  sessions.set(name, s);
  return s;
}

function rpc(s, method, params, ms = 60000) {
  const id = s.nextId++;
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => {
      s.pending.delete(id);
      reject(new Error(`${method} timed out` + (s.stderr ? "\n" + s.stderr : "")));
    }, ms);
    s.pending.set(id, {
      resolve: (v) => { clearTimeout(t); resolve(v); },
      reject: (e) => { clearTimeout(t); reject(e); },
    });
    s.proc.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
  });
}

async function session(name) {
  const live = sessions.get(name);
  if (live?.tools) return live;
  const s = live || open(name);
  if (!s.ready) {
    s.ready = rpc(s, "initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "quire", version: "0.1.0" },
    }, 120000).then(() => {
      s.proc.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n");
    });
  }
  await s.ready;
  s.tools = (await rpc(s, "tools/list", {})).tools || [];
  return s;
}

export const tools = async (name) => (await session(name)).tools;

export async function call(name, tool, args = {}, ms = 300000) {
  const s = await session(name);
  const r = await rpc(s, "tools/call", { name: tool, arguments: args }, ms);
  const text = (r.content || []).filter((c) => c.type === "text").map((c) => c.text).join("\n");
  if (r.isError) throw new Error(`${name}.${tool}: ${text || "tool reported an error"}`);
  return { text, content: r.content || [], structured: r.structuredContent };
}

export function close(name) {
  const s = sessions.get(name);
  if (!s) return false;
  s.proc.kill();
  sessions.delete(name);
  return true;
}
export const closeAll = () => [...sessions.keys()].forEach(close);
