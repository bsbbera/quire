#!/usr/bin/env node
// The other direction of MCP.
//
// mcp.mjs is Quire acting as an MCP *client*, calling servers the user has
// configured. This is Quire acting as an MCP *server*, so an agent CLI can
// call back into the things only Quire can do: render an image on this
// machine's GPU, drive Affinity, read the magazine workspace.
//
// A CLI is already an agent runtime — it runs its own tool loop. So the way
// to give it Quire's tools is to hand it a tool server, not to translate one
// protocol into another. Every CLI here speaks MCP already.
//
// Speaks JSON-RPC over stdio, one message per line.
import { createInterface } from "node:readline";
import * as comfy from "./comfy.mjs";
import * as affinity from "./affinity.mjs";
import { homedir } from "node:os";
import { existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

// The publication store lives in core now, so these tools read what the runner
// writes rather than the old magazine engine's own files.
const WORKSPACE = process.env.QUIRE_WORKSPACE
  || [join(homedir(), "Quire"), join(homedir(), "InkDesk")].find(existsSync)
  || join(homedir(), "Quire");
const CORE = join(dirname(fileURLToPath(import.meta.url)), "inkos", "node_modules", "@actalk", "quire-core");
const core = (rel) => import(pathToFileURL(join(CORE, rel)).href);

/** Every publication, across every installed type. */
async function allPublications() {
  const { loadPublicationRegistry } = await core("dist/publications/registry.js");
  const { listIssues } = await core("dist/pipeline/publication-runner.js");
  const registry = await loadPublicationRegistry(WORKSPACE);
  const out = [];
  for (const { definition } of registry.definitions) {
    out.push(...await listIssues({ projectRoot: WORKSPACE, definition, ask: async () => {
      throw new Error("listing does not call the model");
    } }));
  }
  return out;
}

/**
 * A publication and the runner context for it.
 *
 * core owns this now. Rebuilding a context by hand here is what allowed the
 * build tool below to call affinity.build() directly — with a context of its
 * own making there was nothing to enforce, and the gates the runner applies
 * were simply not in the path.
 */
async function openPublication(id) {
  const { openIssueContext } = await core("dist/pipeline/publication-context.js");
  return openIssueContext(WORKSPACE, id, {
    shimUrl: `http://127.0.0.1:${process.env.SHIM_PORT || "8787"}`,
  });
}

async function readPublication(id) {
  return (await openPublication(id)).issue;
}

const TOOLS = [
  {
    name: "quire_generate_image",
    description:
      "Render an image locally with ComfyUI on this machine's GPU and save it to disk. "
      + "Use for illustrations, covers and page art. Returns the saved file path.",
    inputSchema: {
      type: "object",
      properties: {
        prompt: { type: "string", description: "What to draw." },
        negative: { type: "string", description: "What to avoid." },
        width: { type: "number", description: "Pixels. Omit to use this machine's benchmarked default." },
        height: { type: "number", description: "Pixels. Omit to use this machine's benchmarked default." },
        workflow: { type: "string", description: "Workflow id. Omit to use the selected one." },
        outFile: { type: "string", description: "Absolute path to write the PNG to." },
      },
      required: ["prompt", "outFile"],
    },
    // The bytes are dropped on the way out: a 2MB base64 blob in a tool result
    // costs the model its whole context window and it cannot look at the image
    // anyway. The file path is the useful half.
    run: async (a) => { const { b64, ...rest } = await comfy.generate(a); return rest; },
  },
  {
    name: "quire_image_backend_status",
    description: "Whether the local image backend (ComfyUI) is installed and running.",
    inputSchema: { type: "object", properties: {} },
    run: () => comfy.status(),
  },
  {
    name: "quire_affinity_status",
    description: "Whether Affinity Publisher is available to build a document.",
    inputSchema: { type: "object", properties: {} },
    run: () => affinity.status(),
  },
  {
    name: "quire_affinity_build",
    description:
      "Lay out a publication in Affinity Publisher and export the PDF. Affinity is a pure "
      + "executor here: the copy, the design decision and the page art must already be on "
      + "disk. Starts Affinity if it is not running. Returns the path of the exported PDF.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "Publication id, as returned by quire_list_publications." },
      },
      required: ["id"],
    },
    // Through the runner, not around it.
    //
    // This called affinity.build() directly, which skips the three checks the
    // runner's own build() makes: the copy approved, the design approved, and
    // the design passing its own spec. That is not theoretical — the shipped
    // film-photography issue has `approved` set and no `designApproved` at
    // all, which is the fingerprint of exactly this path.
    run: async (a) => {
      const { ctx } = await openPublication(a.id);
      const { build } = await core("dist/pipeline/publication-runner.js");
      await affinity.ensureRunning();
      const issue = await build(ctx, a.id);
      return { ok: true, pdf: issue.build?.pdf ?? null, status: issue.status };
    },
  },
  {
    name: "quire_list_publications",
    description: "List the publications in the Quire workspace — magazines, or any installed type.",
    inputSchema: { type: "object", properties: {} },
    run: async () => ({ publications: await allPublications() }),
  },
  {
    name: "quire_read_publication",
    description: "Read one publication: its plan, sections, pages and design.",
    inputSchema: {
      type: "object",
      properties: { id: { type: "string", description: "Publication id." } },
      required: ["id"],
    },
    run: (a) => readPublication(a.id),
  },
];

const send = (msg) => process.stdout.write(JSON.stringify(msg) + "\n");
const reply = (id, result) => send({ jsonrpc: "2.0", id, result });
const fail = (id, message) => send({ jsonrpc: "2.0", id, error: { code: -32603, message } });

async function handle(msg) {
  const { id, method, params } = msg;
  if (method === "initialize") {
    return reply(id, {
      protocolVersion: "2024-11-05",
      capabilities: { tools: {} },
      serverInfo: { name: "quire", version: "1" },
    });
  }
  if (method === "notifications/initialized") return; // no reply to a notification
  if (method === "tools/list") {
    return reply(id, {
      tools: TOOLS.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })),
    });
  }
  if (method === "tools/call") {
    const tool = TOOLS.find((t) => t.name === params?.name);
    if (!tool) return fail(id, `unknown tool: ${params?.name}`);
    try {
      const out = await tool.run(params.arguments || {});
      // MCP wants content blocks. Everything here returns structured data, so
      // it goes across as JSON text — every CLI can read that back.
      return reply(id, { content: [{ type: "text", text: JSON.stringify(out) }] });
    } catch (e) {
      // A failed tool is a result, not a transport error: the agent should see
      // why it failed and be able to try something else.
      return reply(id, { content: [{ type: "text", text: `error: ${e.message}` }], isError: true });
    }
  }
  if (id !== undefined) fail(id, `unknown method: ${method}`);
}

// Two transports, one tool table.
//
// MCP is the good channel, but it is not a channel every agent actually has:
// some CLIs only load tool servers from their own (sometimes cloud-managed)
// config and silently ignore what the host offers them. Every agent can run a
// command, though - so the same tools are also callable as argv. Nothing is
// duplicated: this is the same TOOLS array the MCP path dispatches.
//
//   node mcp-server.mjs                      -> MCP over stdio
//   node mcp-server.mjs --list               -> tool names and descriptions
//   node mcp-server.mjs <tool> '<json args>' -> run one tool, print JSON
if (process.argv[2]) {
  const [, , name, json] = process.argv;
  if (name === "--list") {
    console.log(TOOLS.map((t) => `${t.name}\n    ${t.description}`).join("\n"));
    process.exit(0);
  }
  const tool = TOOLS.find((t) => t.name === name);
  if (!tool) {
    console.error(`unknown tool: ${name}\nknown: ${TOOLS.map((t) => t.name).join(", ")}`);
    process.exit(2);
  }
  let args = {};
  if (json) {
    try { args = JSON.parse(json); } catch (e) { console.error("arguments must be JSON: " + e.message); process.exit(2); }
  }
  try {
    console.log(JSON.stringify(await tool.run(args), null, 2));
    process.exit(0);
  } catch (e) {
    console.error(String(e?.message || e));
    process.exit(1);
  }
}

createInterface({ input: process.stdin }).on("line", (line) => {
  if (!line.trim()) return;
  let msg;
  try { msg = JSON.parse(line); } catch { return; }
  handle(msg).catch((e) => { if (msg.id !== undefined) fail(msg.id, e.message); });
});

export { TOOLS };
