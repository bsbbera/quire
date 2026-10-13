#!/usr/bin/env node
/**
 * Quire as an MCP server for an outside agent (Claude Code): the whole HTTP
 * API, so anything the app's screens can do, an agent can do too.
 *
 * cli-shim/mcp-server.mjs is the other one - tools Quire hands its own model
 * CLIs. This drives the app from outside, the same surface quire-ctl.mjs does.
 *
 *   claude mcp add -s user quire -- node <this file>
 *
 * Speaks JSON-RPC over stdio, one message per line.
 */
import { createInterface } from "node:readline";
import { execFile } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const PORTS = { dev: { studio: 4568, shim: 8788 }, prod: { studio: 4567, shim: 8787 } };
const CTL = join(dirname(fileURLToPath(import.meta.url)), "quire-ctl.mjs");
const stageProp = { type: "string", enum: ["dev", "prod"], description: "Which build. Default dev." };

const TOOLS = [
  {
    name: "quire_api",
    description: "Call any Quire HTTP route. A path starting /api goes to Studio (e.g. GET /api/v1/publications, "
      + "POST /api/v1/publications/:id/resume {from, stopAt}, POST /api/v1/publications/:id/audit, "
      + "POST /api/v1/publications/:id/spreads, GET /api/v1/jobs); anything else goes to the model shim "
      + "(e.g. /v1/status, /affinity/open). Model calls can run for minutes.",
    inputSchema: {
      type: "object",
      properties: {
        stage: stageProp,
        method: { type: "string", enum: ["GET", "POST", "PUT", "PATCH", "DELETE"], description: "Default GET, or POST when a body is given." },
        path: { type: "string" },
        body: { description: "JSON body." },
      },
      required: ["path"],
    },
  },
  { name: "quire_status", description: "Is the build up, and its version and default model.", inputSchema: { type: "object", properties: { stage: stageProp } } },
  { name: "quire_up", description: "Start the build and wait until both Studio and the shim answer.", inputSchema: { type: "object", properties: { stage: stageProp } } },
  { name: "quire_down", description: "Stop the build: its window and its servers.", inputSchema: { type: "object", properties: { stage: stageProp } } },
];

async function api({ stage = "dev", method, path, body }) {
  if (!PORTS[stage]) throw new Error(`unknown stage ${stage}`);
  const port = path.startsWith("/api") ? PORTS[stage].studio : PORTS[stage].shim;
  const verb = method ?? (body === undefined ? "GET" : "POST");
  const res = await fetch(`http://127.0.0.1:${port}${path}`, {
    method: verb,
    ...(body === undefined ? {} : { headers: { "content-type": "application/json" }, body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(900_000),
  }).catch((e) => { throw new Error(`${stage} is not answering on :${port} — is it running? (${e.message})`); });
  const text = await res.text();
  // Studio answers unknown paths with its SPA: a miss wearing a 200.
  if (/^\s*<(!doctype|html)/i.test(text)) throw new Error(`${verb} ${path} is not an API route`);
  if (!res.ok) throw new Error(`${verb} ${path} -> ${res.status}\n${text}`);
  return text;
}

const ctl = (stage = "dev", verb) => new Promise((resolve, reject) =>
  execFile(process.execPath, [CTL, stage, verb], { timeout: 180_000 }, (err, out, errOut) =>
    err ? reject(new Error(`${errOut || err.message}`.trim())) : resolve(`${out}${errOut}`.trim())));

const CALLS = {
  quire_api: api,
  quire_status: (a) => ctl(a.stage, "status"),
  quire_up: (a) => ctl(a.stage, "up"),
  quire_down: (a) => ctl(a.stage, "down"),
};

const send = (msg) => process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", ...msg })}\n`);

createInterface({ input: process.stdin }).on("line", async (line) => {
  let msg;
  try { msg = JSON.parse(line); } catch { return; }
  const { id, method, params } = msg;
  if (id === undefined) return; // notifications
  if (method === "initialize") {
    return send({ id, result: {
      protocolVersion: params?.protocolVersion ?? "2024-11-05",
      capabilities: { tools: {} },
      serverInfo: { name: "quire", version: "1.0.0" },
    } });
  }
  if (method === "tools/list") return send({ id, result: { tools: TOOLS } });
  if (method === "tools/call") {
    const fn = CALLS[params?.name];
    if (!fn) return send({ id, error: { code: -32602, message: `unknown tool ${params?.name}` } });
    try {
      return send({ id, result: { content: [{ type: "text", text: String(await fn(params.arguments ?? {})) }] } });
    } catch (e) {
      return send({ id, result: { isError: true, content: [{ type: "text", text: e.message }] } });
    }
  }
  if (method === "ping") return send({ id, result: {} });
  send({ id, error: { code: -32601, message: `no method ${method}` } });
});
