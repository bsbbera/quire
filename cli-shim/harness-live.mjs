/**
 * The harness, against a real CLI.
 *
 * harness.mjs self-checks its own logic with no model involved, which proves
 * the parsing and says nothing about whether an actual agent will play along.
 * This is the other half: start the shim, ask a real CLI for a tool call, and
 * watch what comes back.
 *
 *   node harness-live.mjs              # first CLI that answers
 *   node harness-live.mjs devin        # a specific one
 *   node harness-live.mjs devin -v     # show the raw response bodies
 *
 * It starts its own shim on a spare port and stops it again, so it does not
 * disturb one already running for the app.
 */

import { spawn } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.HARNESS_TEST_PORT || 8799);
const BASE = `http://127.0.0.1:${PORT}/v1`;
const VERBOSE = process.argv.includes("-v") || process.argv.includes("--verbose");
const WANT = process.argv.slice(2).find((a) => !a.startsWith("-"));

/* ------------------------------------------------------------- the tools */

const COMFY = {
  type: "function",
  function: {
    name: "comfy_generate",
    description: "Generate an image locally with ComfyUI.",
    parameters: {
      type: "object",
      properties: { prompt: { type: "string", description: "what to draw" } },
      required: ["prompt"],
    },
  },
};

const PLACE = {
  type: "function",
  function: {
    name: "affinity_place",
    description: "Place an existing image file onto a page of the current publication.",
    parameters: {
      type: "object",
      properties: {
        image: { type: "string", description: "absolute path to the image" },
        page: { type: "integer", description: "1-based page number" },
      },
      required: ["image", "page"],
    },
  },
};

/* ------------------------------------------------------------------ shim */

let shim = null;

async function startShim() {
  // The CLI is spawned by the shim and inherits its environment, so a stray
  // ANTHROPIC_BASE_URL in the parent would silently redirect it. Cleared here
  // for hygiene — but note that `claude` also reads its own settings.json env
  // block, which this cannot reach: a ConnectionRefused from `claude` is worth
  // checking against ~/.claude/settings.json before suspecting the harness.
  const env = { ...process.env, SHIM_PORT: String(PORT) };
  for (const k of ["ANTHROPIC_API_KEY", "ANTHROPIC_BASE_URL", "CLAUDECODE", "CLAUDE_CODE_ENTRYPOINT"]) {
    delete env[k];
  }
  shim = spawn(process.execPath, [join(HERE, "server.mjs")], { env, stdio: ["ignore", "pipe", "pipe"] });
  shim.stdout.on("data", (b) => VERBOSE && process.stdout.write("  [shim] " + b));
  shim.stderr.on("data", (b) => VERBOSE && process.stdout.write("  [shim!] " + b));

  for (let i = 0; i < 40; i++) {
    await new Promise((r) => setTimeout(r, 500));
    try {
      const res = await fetch(`${BASE}/models`);
      if (res.ok) return (await res.json()).data || [];
    } catch { /* not listening yet */ }
  }
  throw new Error("the shim never came up");
}

const stopShim = () => { try { shim?.kill("SIGTERM"); } catch { /* already gone */ } };

async function ask(model, messages, tools) {
  const res = await fetch(`${BASE}/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ model, messages, tools, stream: false }),
  });
  const body = await res.json();
  if (VERBOSE) console.log("  raw:", JSON.stringify(body, null, 2));
  if (body.error) throw new Error(body.error.message);
  return body.choices?.[0] ?? {};
}

/* ----------------------------------------------------------------- checks */

let passed = 0, failed = 0;
const ok = (label, detail) => { passed++; console.log(`  PASS  ${label}${detail ? "\n          " + detail : ""}`); };
const no = (label, why) => { failed++; console.log(`  FAIL  ${label}\n          ${why}`); };

async function check(label, fn) {
  process.stdout.write(`\n> ${label}\n`);
  try {
    const why = await fn();
    if (why) no(label, why); else ok(label);
  } catch (e) {
    no(label, e.message);
  }
}

const callNames = (choice) => (choice.message?.tool_calls || []).map((c) => c.function?.name);
const argsOf = (choice, i = 0) => {
  try { return JSON.parse(choice.message.tool_calls[i].function.arguments); } catch { return {}; }
};

/* ------------------------------------------------------------------- main */

const IMAGE = "C:/work/out/red-square-001.png";

async function main() {
  console.log(`Starting a shim on port ${PORT}...`);
  const models = await startShim();
  if (!models.length) throw new Error("no CLI models detected — is any agent CLI installed?");

  const model = WANT
    ? (models.find((m) => m.id.startsWith(WANT + "/"))?.id
      ?? (() => { throw new Error(`no model for "${WANT}". Have: ${[...new Set(models.map((m) => m.id.split("/")[0]))].join(", ")}`); })())
    : models[0].id;
  console.log(`Testing against: ${model}`);
  console.log(`Detected CLIs:   ${[...new Set(models.map((m) => m.id.split("/")[0]))].join(", ")}`);

  // 1. The host's tool table reaches the model, and a call comes back through
  //    the host rather than being run inside the CLI's own loop.
  await check("a tool call returns through the host", async () => {
    const c = await ask(model, [
      { role: "user", content: "Generate an image of a red square. Use the tool." },
    ], [COMFY]);
    if (c.finish_reason !== "tool_calls") return `finish_reason was "${c.finish_reason}", wanted "tool_calls"`;
    const names = callNames(c);
    if (!names.includes("comfy_generate")) return `called ${JSON.stringify(names)}, wanted comfy_generate`;
    console.log(`          → ${names[0]}(${JSON.stringify(argsOf(c))})`);
    return null;
  });

  // 2. The loop closes: a result the host produced is visible to the model and
  //    determines what it calls next. Without this a run cannot proceed past
  //    its first tool.
  await check("a tool result feeds the next turn", async () => {
    const c = await ask(model, [
      { role: "user", content: "Generate an image of a red square, then place it on page 3." },
      { role: "assistant", content: null, tool_calls: [
        { id: "call_1", type: "function", function: { name: "comfy_generate", arguments: '{"prompt":"red square"}' } },
      ] },
      { role: "tool", tool_call_id: "call_1", name: "comfy_generate", content: JSON.stringify({ image: IMAGE }) },
    ], [COMFY, PLACE]);
    const names = callNames(c);
    if (!names.includes("affinity_place")) return `called ${JSON.stringify(names)}, wanted affinity_place`;
    const a = argsOf(c);
    console.log(`          → affinity_place(${JSON.stringify(a)})`);
    if (a.image !== IMAGE) return `did not carry the path forward: got ${JSON.stringify(a.image)}`;
    if (Number(a.page) !== 3) return `wrong page: got ${JSON.stringify(a.page)}`;
    return null;
  });

  // 3. The one that matters. The CLI used to be handed MCP servers at launch
  //    and told it could shell out to mcp-server.mjs, so it could reach
  //    quire_affinity_build with no host gate in the way. With an empty table
  //    it must now be unable to do the work, and say so.
  await check("an empty tool table closes the bypass", async () => {
    const c = await ask(model, [
      { role: "user", content: "Generate an image of a blue circle and build the magazine PDF. Do it now." },
    ], []);
    if (c.finish_reason !== "stop") return `finish_reason was "${c.finish_reason}", wanted "stop"`;
    if (c.message?.tool_calls?.length) return `called ${JSON.stringify(callNames(c))} with no tools offered`;
    const said = String(c.message?.content || "");
    console.log(`          → "${said.slice(0, 160).replace(/\s+/g, " ")}${said.length > 160 ? "..." : ""}"`);
    if (/mcp-server\.mjs|quire_affinity_build|node .*mcp/i.test(said)) {
      return "the model reached for the command-line bypass";
    }
    return null;
  });

  // 4. The block is a control message. Streamed through as text, the client
  //    renders raw markup and then runs the tool again when the same block
  //    arrives parsed.
  await check("no tool-call block leaks into the text stream", async () => {
    const res = await fetch(`${BASE}/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model, stream: true, tools: [COMFY],
        messages: [{ role: "user", content: "Generate an image of a red square. Use the tool." }],
      }),
    });
    const raw = await res.text();
    if (VERBOSE) console.log("  raw stream:\n" + raw.split("\n").map((l) => "    " + l).join("\n"));

    let sawCall = false, leaked = "";
    for (const line of raw.split("\n")) {
      if (!line.startsWith("data: ") || line.includes("[DONE]")) continue;
      let chunk; try { chunk = JSON.parse(line.slice(6)); } catch { continue; }
      const delta = chunk.choices?.[0]?.delta || {};
      if (delta.tool_calls?.length) sawCall = true;
      if (typeof delta.content === "string" && delta.content.includes("```tool_call")) {
        leaked = delta.content;
      }
    }
    if (leaked) return `a raw block reached the client as text: ${JSON.stringify(leaked.slice(0, 80))}`;
    if (!sawCall) return "the stream carried no tool_calls delta";
    console.log("          → call arrived as a tool_calls delta, no fence in the text");
    return null;
  });

  console.log(`\n${failed ? "FAILED" : "OK"}  ${passed} passed, ${failed} failed\n`);
  return failed ? 1 : 0;
}

main()
  .then((code) => { stopShim(); process.exit(code); })
  .catch((e) => { stopShim(); console.error("\nharness-live: " + e.message + "\n"); process.exit(1); });
