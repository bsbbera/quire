#!/usr/bin/env node
// OpenAI-compatible shim over agent CLIs (claude / codex / devin / antigravity).
// Adapter shapes mirror Open Design's daemon runtime defs.
// Point InkOS at: baseUrl=http://127.0.0.1:8787/v1  apiKey=local  model=<cli>/<model>
import { createServer } from "node:http";
import { spawn, execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";

const PORT = process.env.SHIM_PORT || 8787;
const LANG = process.env.SHIM_LANG || "English";
const HOME = homedir();
const HERE = dirname(fileURLToPath(import.meta.url));

// Where publications live now: the workspace, under each definition's own
// outDir. The old magazine engine kept its own store and told everything else
// where it was; the runner in core owns that, so this is only what the
// ComfyUI installer and the doctor need in order to look in the right place.
const PUBLICATION_ROOT = join(
  process.env.QUIRE_WORKSPACE
    || [join(HOME, "Quire"), join(HOME, "InkDesk")].find(existsSync)
    || join(HOME, "Quire"),
  "Magazine",
);
const STUDIO_URL = process.env.STUDIO_URL || `http://localhost:${process.env.STUDIO_PORT || 4567}`;

// Integrations. Loaded eagerly: a broken module should fail at boot with a
// stack, not at 3am inside a request handler.
const mcp = await import("./mcp.mjs");
const comfy = await import("./comfy.mjs");
const affinity = await import("./affinity.mjs");
const preflight = await import("./preflight.mjs");
const comfyInstall = await import("./comfy-install.mjs");
const workflows = await import("./workflows.mjs");

// ------------------------------------------------------------- persisted model
// The chosen model lives in Studio's own project config, because each CLI is
// now a real provider there (claudeCli, devinCli, ...) and Studio's Model
// Config is the one place a model gets picked.
//
// It used to live in ~/.inkos/.env, which Studio deliberately ignores — so a
// save reached the CLI but not the workbench, and a second call had to poke
// Studio's import-env route to copy the value across. One selection, one
// home, no copy step.
const serviceForCli = (cli) => `${cli}Cli`;

// Remembered so the completions path can fall back to the selected model
// without an HTTP round trip mid-request. Refreshed on every read and write.
let lastModel = null;

async function readSelectedModel() {
  try {
    const r = await fetch(`${STUDIO_URL}/api/v1/services/config`);
    if (!r.ok) return lastModel;
    const cfg = await r.json();
    lastModel = typeof cfg.defaultModel === "string" ? cfg.defaultModel : null;
    return lastModel;
  } catch { return lastModel; }
}

async function writeSelectedModel(model) {
  const service = serviceForCli(String(model).split("/")[0]);
  const r = await fetch(`${STUDIO_URL}/api/v1/services/config`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      service,
      defaultModel: model,
      services: { [service]: { models: [model] } },
      configSource: "studio",
    }),
  });
  if (!r.ok) throw new Error(`studio rejected the model (${r.status})`);
  lastModel = model;
}

// ponytail: don't inherit a host agent's session env — a parent Claude Code /
// Codex leaks ANTHROPIC_API_KEY + ANTHROPIC_BASE_URL and hijacks child auth.
const childEnv = process.env.SHIM_KEEP_ENV ? { ...process.env } : Object.fromEntries(
  Object.entries(process.env).filter(([k]) => !/^(CLAUDE_CODE_|ANTHROPIC_|CODEX_|DEVIN_)/.test(k)));

const run = (bin, args, ms = 15000) => {
  try {
    return execFileSync(bin, args, { encoding: "utf8", timeout: ms, windowsHide: true,
      env: childEnv, stdio: ["ignore", "pipe", "ignore"], maxBuffer: 64 << 20 });
  } catch { return ""; }
};
const which = (n) => run(process.platform === "win32" ? "where" : "which", [n], 5000)
  .split(/\r?\n/)[0].trim() || null;
const globFirst = (pattern) => {
  const pat = pattern.replace(/\\/g, "/"); // join() gives backslashes on win32
  const i = pat.indexOf("*");
  const dir = pat.slice(0, i).replace(/\/$/, "");
  const tail = pat.slice(i + 2); // skip "*/"
  try { for (const s of readdirSync(dir)) { const p = join(dir, s, tail); if (existsSync(p)) return p; } } catch {}
  return null;
};

// ---------------------------------------------------------------- ACP (devin)
// JSON-RPC over stdio: initialize -> session/new -> result.
// The full catalog lives in the `model` configOption's `values[]`; the smaller
// `models.availableModels` is only what the CLI currently has loaded.
function acpModelIds(result) {
  const cfg = (result?.configOptions || []).find((o) => o?.id === "model" || o?.category === "model");
  // `options` on devin's current ACP build; Open Design's copy reads `values`.
  const fromCfg = [...(cfg?.options || []), ...(cfg?.values || [])]
    .map((v) => v?.value || v?.id).filter(Boolean);
  if (fromCfg.length) return fromCfg;
  return (result?.models?.availableModels || []).map((m) => m?.modelId).filter(Boolean);
}

// JSON-RPC over stdio: initialize -> session/new -> result.models
function acp(bin, args, handler) {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { env: childEnv, windowsHide: true, stdio: ["pipe", "pipe", "ignore"] });
    let buf = "", done = false;
    const send = (id, method, params) =>
      child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
    const finish = (v) => { if (done) return; done = true; clearTimeout(timer);
      try { child.kill("SIGTERM"); } catch {} resolve(v); };
    const timer = setTimeout(() => { if (!done) { done = true; try { child.kill("SIGTERM"); } catch {}
      reject(new Error("acp timeout")); } }, 300000);
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (c) => {
      buf += c;
      for (let nl; (nl = buf.indexOf("\n")) >= 0;) {
        const line = buf.slice(0, nl).trim(); buf = buf.slice(nl + 1);
        if (!line) continue;
        let m; try { m = JSON.parse(line); } catch { continue; }
        if (m.id === 1 && m.result) {
          // Only a real run gets the tools: the model-listing call passes no
          // handler and would just pay the startup cost for nothing.
          const servers = MCP_ON && handler ? [{ name: "quire", ...MCP_SPEC }] : [];
          send(2, "session/new", { cwd: process.cwd(), mcpServers: servers });
          continue;
        }
        if (m.id === 2 && m.result) {
          if (!handler) return finish(acpModelIds(m.result));
          handler.onSession({ result: m.result, sessionId: m.result.sessionId, send, finish });
          continue;
        }
        handler?.onMessage?.(m, finish);
      }
    });
    child.on("error", (e) => { clearTimeout(timer); if (!done) { done = true; reject(e); } });
    child.on("close", () => { clearTimeout(timer); if (!done) { done = true; resolve([]); } });
    send(1, "initialize", { protocolVersion: 1, clientCapabilities: { terminal: false },
      clientInfo: { name: "inkos-shim", version: "1" } });
  });
}

// Quire's own tools, offered to the CLIs as an MCP server.
//
// A CLI is an agent runtime: it runs its own tool loop, and every one of them
// speaks MCP. So the tools go across as a tool server rather than being
// translated into each CLI's own protocol. QUIRE_MCP=0 turns it off.
const MCP_SERVER = join(HERE, "mcp-server.mjs");
const MCP_ON = process.env.QUIRE_MCP !== "0";
// Named "quire" everywhere, so the tools appear under one predictable prefix
// (claude exposes them as mcp__quire__*).
const MCP_SPEC = { command: process.execPath, args: [MCP_SERVER], env: {} };

const DEVIN_ACP_ARGS = ["--permission-mode", "dangerous", "--respect-workspace-trust", "false", "acp"];

// ------------------------------------------------------------------- adapters
const AGENTS = [
  {
    id: "claude", bins: ["claude", "openclaude"],
    // `claude` has no list-models subcommand; the aliases already track latest.
    models: () => ["default", "opus", "sonnet", "haiku"],
    args: (m) => ["-p", "--output-format", "stream-json", "--verbose", "--include-partial-messages",
      ...(m && m !== "default" ? ["--model", m] : []), "--permission-mode", "bypassPermissions",
      // Deliberately not --strict-mcp-config: that would also switch off the
      // servers the user configured for themselves.
      ...(MCP_ON ? ["--mcp-config", JSON.stringify({ mcpServers: { quire: MCP_SPEC } }),
        "--allowedTools", "mcp__quire__*"] : [])],
    stream: "claude-json",
  },
  {
    id: "codex", bins: ["codex", join(process.env.LOCALAPPDATA || "", "OpenAI/Codex/bin/*/codex.exe")],
    models: (bin) => {
      try {
        return (JSON.parse(run(bin, ["debug", "models"], 25000)).models || [])
          .filter((m) => m.visibility !== "hidden").map((m) => m.slug).filter(Boolean);
      } catch { return []; }
    },
    fallback: ["default", "gpt-5.6-terra", "gpt-5.3-codex", "gpt-5-codex", "gpt-5"],
    args: (m) => ["exec", "--json", "--skip-git-repo-check", "--sandbox", "danger-full-access",
      ...(m && m !== "default" ? ["-m", m] : []),
      // codex exec has no --mcp-config; -c overrides the same keys its
      // config.toml uses, so the server is added for this run only.
      ...(MCP_ON ? ["-c", `mcp_servers.quire.command=${JSON.stringify(process.execPath)}`,
        "-c", `mcp_servers.quire.args=[${JSON.stringify(MCP_SERVER)}]`] : [])],
    stream: "codex-json",
  },
  {
    id: "devin", bins: ["devin", join(HOME, "AppData/Local/devin/cli/bin/devin.exe")],
    // Devin's full catalog only exists over ACP: initialize -> session/new -> result.models
    models: async (bin) => {
      try {
        const list = await acp(bin, DEVIN_ACP_ARGS, null);
        return list;
      } catch { return []; }
    },
    fallback: ["default", "adaptive", "swe", "opus", "sonnet", "codex", "gpt", "gemini"],
    stream: "acp",
  },
  {
    id: "antigravity", bins: ["agy", join(HOME, "AppData/Local/agy/bin/agy.exe")],
    // `agy models` prints "<slug>\tLabel" lines. Open Design mirrors this list
    // statically because it hangs on an stdin pipe that never closes — but with
    // stdin ignored (as run() does) it returns fine, so fetch it live and let
    // the static copy below be the fallback.
    models: (bin) => {
      const ids = run(bin, ["models"], 30000).split(/\r?\n/)
        .filter((l) => l.includes("\t")).map((l) => l.split("\t")[0].trim()).filter(Boolean);
      return ids.length ? ["default", ...ids] : [];
    },
    fallback: ["default",
      "gemini-3.7-flash-high", "gemini-3.7-flash-medium", "gemini-3.7-flash-low",
      "gemini-3.6-flash-high", "gemini-3.6-flash-medium", "gemini-3.6-flash-low",
      "gemini-3.5-flash-high", "gemini-3.5-flash-medium", "gemini-3.5-flash-low",
      "gemini-3.1-pro-high", "gemini-3.1-pro-low",
      "claude-sonnet-4-6", "claude-opus-4-6-thinking", "gpt-oss-120b-medium"],
    // agy takes a literal "-" as the prompt and drops the pipe, so pass no
    // prompt flag at all: bare stdin. Flags must precede any positional arg.
    args: (m) => [...(m && m !== "default" ? ["--model", m] : []), "--dangerously-skip-permissions"],
    stream: "plain",
  },
];

const resolveBin = (a) => {
  for (const b of a.bins) {
    if (!b) continue;
    const p = b.includes("*") ? globFirst(b) : (existsSync(b) ? b : which(b));
    if (p) return p;
  }
  return null;
};

const versionOf = (bin) => (run(bin, ["--version"], 8000).trim().split(/\r?\n/).pop() || "?").trim();

let binCache = { at: 0, list: [] };
const detect = () => { // 30s cache: install / uninstall / update picked up with no restart
  if (Date.now() - binCache.at < 30000) return binCache.list;
  const list = [];
  for (const a of AGENTS) {
    const bin = resolveBin(a);
    if (!bin) continue;
    const prev = binCache.list.find((p) => p.id === a.id);
    // Re-running --version on every 30s sweep is wasteful; only re-probe when
    // the resolved path changed or we have not seen this agent before.
    const version = prev && prev.bin === bin ? prev.version : versionOf(bin);
    list.push({ ...a, bin, version });
  }
  binCache = { at: Date.now(), list };
  return list;
};

// Cache key is every detected CLI's version, so a `claude update` / `codex
// update` invalidates the catalog by itself — no restart, no manual refresh.
const fingerprint = (agents) => agents.map((a) => `${a.id}@${a.version}`).sort().join("|");

let modelCache = { at: 0, key: null, data: null };
async function listModels() {
  const agents = detect();
  const key = fingerprint(agents);
  if (modelCache.data && modelCache.key === key && Date.now() - modelCache.at < 300000) {
    return modelCache.data;
  }
  const out = [];
  for (const a of agents) {
    let ids = [];
    try { ids = await a.models(a.bin); } catch {}
    if (!ids.length) ids = a.fallback || ["default"];
    for (const id of [...new Set(ids)]) out.push({ id: `${a.id}/${id}`, object: "model", owned_by: a.id });
  }
  modelCache = { at: Date.now(), key, data: out };
  return out;
}

// -------------------------------------------------------------- stream parsing

// A CLI executes its own tools; by the time we see a tool event the work is
// already done. So tool use is reported into the text stream as a marker,
// never re-emitted as OpenAI tool_calls — that would tell Studio to run a tool
// the CLI has already run.
const toolMark = (name) => name ? `\n› ${name}\n` : "";

function extractDelta(stream, line) {
  if (stream === "plain") return line + "\n";
  let m; try { m = JSON.parse(line); } catch { return ""; }
  if (stream === "claude-json") {
    if (m.type === "stream_event" && m.event?.type === "content_block_delta"
      && m.event.delta?.type === "text_delta") return m.event.delta.text || "";
    if (m.type === "stream_event" && m.event?.type === "content_block_start"
      && m.event.content_block?.type === "tool_use") {
      return toolMark(m.event.content_block.name);
    }
    return "";
  }
  if (stream === "codex-json") {
    if (typeof m.delta === "string") return m.delta;
    if (m.type === "item.completed" && m.item?.type === "agent_message") return m.item.text || "";
    if (m.msg?.type === "agent_message_delta") return m.msg.delta || "";
    if (m.msg?.type === "agent_message") return m.msg.message || "";
    if (m.type === "item.started" && m.item?.type === "mcp_tool_call") {
      return toolMark(m.item.tool || m.item.name);
    }
    if (m.msg?.type === "mcp_tool_call_begin") {
      return toolMark(m.msg.invocation?.tool || m.msg.tool);
    }
    return "";
  }
  return "";
}
const finalOf = (stream, line) => {
  if (stream !== "claude-json") return "";
  let m; try { m = JSON.parse(line); } catch { return ""; }
  return m.type === "result" && typeof m.result === "string" ? m.result : "";
};

const sse = (res, obj) => res.write("data: " + JSON.stringify(obj) + "\n\n");
const chunkOf = (model, delta, finish = null) => ({
  id: "shim", object: "chat.completion.chunk", created: (Date.now() / 1e3) | 0, model,
  choices: [{ index: 0, delta: delta ? { content: delta } : {}, finish_reason: finish }],
});

function flatten(msgs) {
  const sys = msgs.filter((m) => m.role === "system").map((m) => m.content).join("\n");
  const rest = msgs.filter((m) => m.role !== "system")
    .map((m) => "[" + m.role + "]\n" + m.content).join("\n\n");
  return (sys ? sys + "\n\n" : "") + "Always respond in " + LANG + ".\n\n" + rest;
}

// ------------------------------------------------------------------ completion
async function complete({ agent, model, prompt, streaming, res, fullModel }) {
  let got = "";
  const send = (t) => { if (!t) return; got += t; if (streaming) sse(res, chunkOf(fullModel, t)); };
  const done = () => {
    if (res.writableEnded) return;
    if (streaming) {
      sse(res, chunkOf(fullModel, "", "stop"));
      res.write("data: [DONE]\n\n");
      res.end();
    } else {
      const n = (s) => Math.ceil((s || "").length / 4);
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({
        id: "shim-" + Date.now(), object: "chat.completion", created: (Date.now() / 1e3) | 0,
        model: fullModel,
        choices: [{ index: 0, message: { role: "assistant", content: got }, finish_reason: "stop" }],
        usage: { prompt_tokens: n(prompt), completion_tokens: n(got), total_tokens: n(prompt) + n(got) },
      }));
    }
  };

  if (agent.stream === "acp") { // devin
    let rpc = null, sid = null;
    const sendPrompt = () => rpc(4, "session/prompt",
      { sessionId: sid, prompt: [{ type: "text", text: prompt }] });
    const handler = {
      onSession: ({ result, sessionId, send: s }) => {
        rpc = s; sid = sessionId;
        if (!model || model === "default") return sendPrompt();
        // model configOption -> set_config_option; otherwise the older set_model
        const cfg = (result.configOptions || []).find((o) => o?.id === "model" || o?.category === "model");
        if (cfg) rpc(3, "session/set_config_option", { sessionId: sid, configId: cfg.id, value: model });
        else rpc(3, "session/set_model", { sessionId: sid, modelId: model });
      },
      onMessage: (m, finish) => {
        const u = m.params?.update;
        if (m.method === "session/update" && u?.sessionUpdate === "agent_message_chunk"
          && u.content?.type === "text") send(u.content.text);
        if (m.method === "session/update" && u?.sessionUpdate === "tool_call") {
          send(toolMark(u.title || u.kind || u.toolCallId));
        }
        if (m.id === 3) return sendPrompt(); // model set (or rejected) -> prompt anyway
        if (m.id === 4 && (m.result || m.error)) {
          if (m.error) send("[devin error] " + JSON.stringify(m.error).slice(0, 500));
          done(); finish(null);
        }
      },
    };
    await acp(agent.bin, DEVIN_ACP_ARGS, handler);
    done();
    return;
  }

  const child = spawn(agent.bin, agent.args(model),
    { env: childEnv, windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
  let buf = "", err = "", sawDelta = false, finalText = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (c) => { err = (err + c).slice(-8000); });
  const onLine = (l) => {
    const d = extractDelta(agent.stream, l);
    if (d) { sawDelta = true; send(d); return; }
    const f = finalOf(agent.stream, l);
    if (f) finalText = f;
  };
  child.stdout.on("data", (c) => {
    buf += c;
    for (let nl; (nl = buf.indexOf("\n")) >= 0;) {
      const l = buf.slice(0, nl).trim(); buf = buf.slice(nl + 1);
      if (l) onLine(l);
    }
  });
  child.stdin.on("error", () => {});
  child.stdin.write(prompt);
  child.stdin.end();
  await new Promise((r) => child.on("close", r));
  if (buf.trim()) onLine(buf.trim());
  // --include-partial-messages only exists on newer claude builds; fall back
  // to the single final `result` event when no deltas ever arrived.
  if (!sawDelta && finalText) send(finalText);
  if (!got && err) send("[" + agent.id + " error] " + err.trim().slice(0, 1000));
  done();
}

// ---------------------------------------------------------------------- server
const json = (res, code, body) => {
  res.writeHead(code, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
};

createServer((req, res) => {
  const path = req.url.split("?")[0];
  res.setHeader("access-control-allow-origin", "*");
  res.setHeader("access-control-allow-headers", "*");
  if (req.method === "OPTIONS") { res.writeHead(204); return res.end(); }

  // Control panel. Read off disk per request so editing ui.html and hitting
  // reload is the whole dev loop — no restart, no build step.
  if (path === "/" || path === "/index.html") {
    try {
      const html = readFileSync(join(HERE, "ui.html"));
      res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
      return res.end(html);
    } catch (e) { return json(res, 500, { error: e.message }); }
  }

  // Provider logos, addressed by agent id so the UI never hardcodes filenames.
  if (path.startsWith("/assets/")) {
    const id = path.slice("/assets/".length).replace(/[^a-z0-9-]/gi, "");
    for (const ext of [".svg", ".png"]) {
      const file = join(HERE, "assets", id + ext);
      if (!existsSync(file)) continue;
      res.writeHead(200, {
        "content-type": ext === ".svg" ? "image/svg+xml" : "image/png",
        "cache-control": "max-age=86400",
      });
      return res.end(readFileSync(file));
    }
    return json(res, 404, { error: "no asset for " + id });
  }

  // Persisted model selection.
  if (path === "/config") {
    if (req.method === "GET") {
      return readSelectedModel().then((model) => json(res, 200, { model, source: "studio" }));
    }
    if (req.method === "POST") {
      let raw = "";
      req.on("data", (d) => { raw += d; });
      return req.on("end", async () => {
        try {
          const { model } = JSON.parse(raw || "{}");
          if (!model || !String(model).includes("/")) throw new Error("model must be <cli>/<name>");
          const cli = String(model).split("/")[0];
          if (!detect().some((a) => a.id === cli)) throw new Error("cli not detected: " + cli);
          await writeSelectedModel(model);
          json(res, 200, { ok: true, model, source: "studio" });
        } catch (e) { json(res, 400, { ok: false, error: e.message }); }
      });
    }
  }

  // Machine-readable status: every UI (tray, web panel, desktop shell) renders
  // this its own way.
  // Exact paths only: a suffix match here also swallowed /comfy/status.
  if (path === "/status" || path === "/v1/status") {
    if (req.url.includes("fresh=1")) { binCache = { at: 0, list: binCache.list }; modelCache.key = null; }
    return listModels().then((models) => json(res, 200, {
      ok: true, port: Number(PORT), lang: LANG, studioUrl: STUDIO_URL,
      model: lastModel,
      agents: detect().map((a) => ({
        id: a.id, bin: a.bin, version: a.version,
        models: models.filter((m) => m.owned_by === a.id).length,
      })),
      total: models.length,
    })).catch((e) => json(res, 500, { ok: false, error: e.message }));
  }

  // /v1/models is every CLI at once. /<cli>/v1/models is one of them, which is
  // what lets each CLI be a separate provider in Studio instead of four
  // providers all listing the same 200-odd models as each other's.
  // Ids stay fully qualified (claude/opus) so chat/completions needs no change.
  if (path.endsWith("/models")) {
    const only = /^\/([a-z0-9-]+)\/v1\/models$/.exec(path)?.[1];
    return listModels().then((data) => json(res, 200, {
      object: "list",
      data: only ? data.filter((m) => m.owned_by === only) : data,
    }));
  }
  // ------------------------------------------------------------ integrations
  const bodyOf = () => new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", (d) => { raw += d; });
    req.on("end", () => { try { resolve(raw ? JSON.parse(raw) : {}); } catch (e) { reject(e); } });
  });
  const handle = (p) => p.then((v) => json(res, 200, v === undefined ? { ok: true } : v))
    .catch((e) => json(res, 400, { ok: false, error: e.message }));

  if (path === "/mcp/servers") {
    return handle(Promise.resolve({ servers: mcp.servers() }));
  }
  if (path === "/mcp/tools") {
    const name = new URL(req.url, "http://x").searchParams.get("server");
    return handle(mcp.tools(name).then((tools) => ({ server: name, tools })));
  }
  if (path === "/mcp/call" && req.method === "POST") {
    return handle(bodyOf().then((b) => mcp.call(b.server, b.tool, b.args || {})));
  }
  if (path === "/mcp/toggle" && req.method === "POST") {
    return handle(bodyOf().then((b) => {
      const f = join(HOME, ".inkos", "mcp.json");
      const cfg = existsSync(f) ? JSON.parse(readFileSync(f, "utf8")) : {};
      // Two lists, not one: a server the source app ships disabled needs an
      // explicit opt-in, so clearing `disabled` alone would not switch it on.
      const off = new Set(cfg.disabled || []);
      const on = new Set(cfg.enabled || []);
      if (b.enabled) { off.delete(b.server); on.add(b.server); }
      else { on.delete(b.server); off.add(b.server); }
      cfg.disabled = [...off];
      cfg.enabled = [...on];
      mkdirSync(dirname(f), { recursive: true });
      writeFileSync(f, JSON.stringify(cfg, null, 2));
      if (!b.enabled) mcp.close(b.server);
      return { ok: true, disabled: cfg.disabled, enabled: cfg.enabled };
    }));
  }

  // One call the setup panel can hang off, so a fresh install has a single
  // place that says what is missing instead of three green/red dots to read.
  if (path === "/doctor") {
    return handle((async () => {
      const [comfyStatus, affinityStatus] = await Promise.all([
        comfy.status().catch((e) => ({ up: false, installed: false, reason: e.message })),
        affinity.status().catch((e) => ({ up: false, reason: e.message })),
      ]);
      let servers = {};
      try { servers = await mcp.servers(); } catch {}
      return preflight.doctor({ comfyStatus, affinityStatus, servers, magRoot: PUBLICATION_ROOT });
    })());
  }

  if (path === "/affinity/status") return handle(affinity.status());
  // Affinity as a pure executor: everything it needs — copy, design decision,
  // images — is already decided and on disk by the time this is called.
  if (path === "/affinity/build" && req.method === "POST") {
    return handle(bodyOf().then(async (b) => {
      if (!b.issue || !b.issueDir) throw new Error("issue and issueDir are required");
      const pdf = b.pdf || join(b.issueDir, "build", `${b.issue.id}.pdf`);
      const out = await affinity.build(b.issue, { pdf, issueDir: b.issueDir });
      return { ok: true, ...out, pdf: existsSync(pdf) ? pdf : null };
    }));
  }
  if (path === "/comfy/status") return handle(comfy.status());
  // Installing ComfyUI is the one setup step Quire can do for the user; the
  // plan is a separate call so the panel can show the size before committing
  // ~17GB of download.
  if (path === "/comfy/install-plan") return handle(comfyInstall.plan({ magRoot: PUBLICATION_ROOT }));
  if (path === "/comfy/install" && req.method === "POST") {
    return handle(bodyOf().then((b) =>
      comfyInstall.install({ magRoot: PUBLICATION_ROOT, dir: b.dir, workflow: b.workflow })));
  }
  if (path === "/comfy/start" && req.method === "POST") return handle(comfy.start());
  if (path === "/comfy/generate" && req.method === "POST") {
    return handle(bodyOf().then((b) => comfy.generate(b)));
  }
  // Measured on this machine, not guessed from a spec sheet: one small render,
  // timed, and the device tier it implies written down as the locked default.
  if (path === "/comfy/benchmark" && req.method === "POST") return handle(comfy.benchmark());
  // Declining the first-run install has to stick, or every launch asks again.
  if (path === "/comfy/skip" && req.method === "POST") {
    return handle(Promise.resolve().then(() => workflows.saveConfig({ skipped: true })));
  }

  // Workflows: list, select, add, delete. The builtin is what everything falls
  // back to, so remove() refuses it rather than leaving a machine with an
  // installed ComfyUI and no graph to run.
  if (path === "/comfy/workflows" && req.method === "GET") {
    return handle(Promise.resolve().then(() => {
      const { workflows: all, diagnostics } = workflows.list();
      const current = workflows.selected();
      return {
        selected: current?.id ?? null,
        workflows: all.map((w) => ({
          id: w.id, label: w.label, note: w.note ?? "", builtin: w.builtin,
          source: w.source, models: (w.models || []).map((m) => m.file),
          settings: w.settings,
        })),
        diagnostics,
      };
    }));
  }
  if (path === "/comfy/workflows" && req.method === "POST") {
    return handle(bodyOf().then((b) => workflows.add(b)));
  }
  {
    const m = /^\/comfy\/workflows\/([a-z0-9][a-z0-9-]*)$/.exec(path);
    if (m && req.method === "DELETE") return handle(Promise.resolve().then(() => workflows.remove(m[1])));
    if (m && req.method === "PUT") return handle(Promise.resolve().then(() => workflows.select(m[1])));
  }

  // Progress for the magazine workspace. Studio has its own /api/v1/events for
  // book writing; this is the same idea for a pipeline Studio knows nothing of.
  if (!path.endsWith("/chat/completions")) return json(res, 404, { error: { message: "not found" } });

  let raw = "";
  req.on("data", (d) => { raw += d; });
  req.on("end", async () => {
    let body; try { body = JSON.parse(raw); } catch { return json(res, 400, { error: { message: "bad json" } }); }
    // A caller that names no model (or a bare cli id) gets the saved selection.
    const wanted = String(body.model || "").includes("/")
      ? body.model
      : ((await readSelectedModel()) || body.model || "");
    const [cliId, ...rest] = String(wanted).split("/");
    const agent = detect().find((a) => a.id === cliId);
    if (!agent) return json(res, 400, { error: { message: "cli not detected: " + cliId } });
    // OpenAI's contract: absent `stream` means a plain JSON reply. Defaulting
    // to SSE hands unparseable text to any client that never asked for it.
    const streaming = body.stream === true;
    if (streaming) {
      res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache",
        connection: "keep-alive" });
    }
    try {
      await complete({ agent, model: rest.join("/"), prompt: flatten(body.messages || []),
        streaming, res, fullModel: wanted });
    } catch (e) {
      if (res.writableEnded) return;
      if (streaming) { sse(res, chunkOf(body.model, "[shim error] " + e.message, "stop")); res.end(); }
      else json(res, 502, { error: { message: e.message } });
    }
  });
}).listen(PORT, "127.0.0.1", () =>
  console.log("shim http://127.0.0.1:" + PORT + "/v1  lang=" + LANG
    + "  detected: " + (detect().map((a) => a.id).join(", ") || "none")));
