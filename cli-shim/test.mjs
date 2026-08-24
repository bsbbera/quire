#!/usr/bin/env node
// Smallest thing that fails if the shim breaks. Assumes the shim is running.
//   node cli-shim/test.mjs            -> status + models only (fast, offline)
//   node cli-shim/test.mjs --live     -> also one real streamed completion per CLI
import assert from "node:assert/strict";

const BASE = `http://127.0.0.1:${process.env.SHIM_PORT || 8787}`;
const LIVE = process.argv.includes("--live");
let failures = 0;

// Async checks are tracked rather than awaited at each call site: one missed
// await used to let a late failure land after the summary had already printed
// a pass and exited 0.
const pending = [];
const check = (name, fn) => {
  const p = (async () => {
    try { await fn(); console.log(`  ok   ${name}`); }
    catch (e) { failures++; console.log(`  FAIL ${name}: ${e.message}`); }
  })();
  pending.push(p);
  return p;
};

async function streamOnce(model) {
  const res = await fetch(`${BASE}/v1/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      model, stream: true,
      messages: [{ role: "user", content: "Reply with exactly: PONG. Nothing else." }],
    }),
  });
  let text = "", sawDone = false;
  for await (const chunk of res.body) {
    for (const line of String(chunk).split("\n")) {
      if (!line.startsWith("data: ")) continue;
      const payload = line.slice(6).trim();
      if (payload === "[DONE]") { sawDone = true; continue; }
      const d = JSON.parse(payload).choices?.[0]?.delta?.content;
      if (d) text += d;
    }
  }
  return { text: text.trim(), sawDone };
}

console.log("status:");
const status = await fetch(`${BASE}/status`).then((r) => r.json());
check("ok flag", () => assert.equal(status.ok, true));
check("at least one CLI detected", () => assert.ok(status.agents.length > 0));
check("every agent reports a version", () =>
  assert.ok(status.agents.every((a) => a.version && a.version !== "?"), JSON.stringify(status.agents)));
check("models counted", () => assert.ok(status.total > 0));
for (const a of status.agents) console.log(`       ${a.id} ${a.version} — ${a.models} models`);

console.log("models:");
const models = await fetch(`${BASE}/v1/models`).then((r) => r.json());
check("openai list shape", () => assert.equal(models.object, "list"));
check("ids are <cli>/<model>", () =>
  assert.ok(models.data.every((m) => m.id.includes("/") && m.owned_by)));
check("count matches status", () => assert.equal(models.data.length, status.total));

// Each CLI is its own provider in Studio, which only works if /<cli>/v1/models
// returns that CLI alone. When it regressed, all four providers listed the
// same 200-odd models and picking one gave you another CLI's model.
const perCli = Object.fromEntries(await Promise.all(status.agents.map(async (a) => [
  a.id, await fetch(`${BASE}/${a.id}/v1/models`).then((r) => r.json()),
])));
check("per-cli route returns only that cli", () => {
  for (const [id, list] of Object.entries(perCli)) {
    assert.ok(list.data.length > 0, `${id} listed nothing`);
    const strays = [...new Set(list.data.map((m) => m.owned_by))].filter((o) => o !== id);
    assert.deepEqual(strays, [], `${id} also listed ${strays.join(",")}`);
  }
});
check("per-cli routes sum to the full catalogue", () =>
  assert.equal(
    Object.values(perCli).reduce((n, l) => n + l.data.length, 0),
    models.data.length,
  ));

check("unknown cli is rejected", async () => {});
const bad = await fetch(`${BASE}/v1/chat/completions`, {
  method: "POST", headers: { "content-type": "application/json" },
  body: JSON.stringify({ model: "nope/x", stream: false, messages: [] }),
});
check("unknown cli -> 400", () => assert.equal(bad.status, 400));

if (LIVE) {
  console.log("live completions (one per CLI, slow):");
  for (const a of status.agents) {
    const model = models.data.find((m) => m.owned_by === a.id)?.id;
    try {
      const { text, sawDone } = await streamOnce(model);
      check(`${a.id} streams`, () => {
        assert.ok(sawDone, "no [DONE] terminator");
        assert.ok(text.length > 0, "no content");
        assert.ok(!/error/i.test(text), text.slice(0, 120));
      });
    } catch (e) {
      failures++;
      console.log(`  FAIL ${a.id} streams: ${e.message}`);
    }
  }
} else {
  console.log("live completions: skipped (pass --live to run)");
}

// ---------------------------------------------------------------- integrations
const mcpMod = await import("./mcp.mjs");

check("mcp discovery finds configured servers", () => {
  const found = mcpMod.servers();
  assert.ok(Object.keys(found).length > 0, "no MCP servers discovered");
  // Extension paths live under "Claude Extensions". If the Windows shell
  // quoting regresses, the command silently loses everything after the space.
  for (const [name, cfg] of Object.entries(found)) {
    assert.ok(!/\bClaude$/.test(cfg.command), name + " command truncated at a space: " + cfg.command);
  }
});

// A fresh install leans entirely on the doctor being right about what is
// missing, so pin the one rule that matters: a required failure must be
// blocking, an optional one must not be.
{
  const { doctor } = await import("./preflight.mjs");
  const d = await doctor({
    comfyStatus: { up: false, installed: false },
    affinityStatus: { up: false, reason: "off" },
    servers: {},
    magRoot: process.cwd(),
  });
  check("doctor reports missing optional deps without blocking", () => {
    const byId = Object.fromEntries(d.checks.map((c) => [c.id, c]));
    assert.equal(byId.comfy.ok, false);
    assert.equal(byId.comfy.severity, "optional");
    assert.equal(byId.affinity.severity, "optional");
    assert.ok(byId.comfy.fix, "a failed check must say how to fix it");
    assert.equal(d.blocking, d.checks.filter((c) => !c.ok && c.severity === "required").length);
  });
  check("doctor skips the model check when ComfyUI is absent", () => {
    assert.ok(!d.checks.some((c) => c.id === "comfy-models"));
  });
}

// The workflow names three checkpoints and the installer downloads three. Add
// a model to the graph without adding its URL and renders fail on a machine
// that installed through Quire but not on the one that developed it.
{
  const { MODELS } = await import("./comfy.mjs");
  // Resolved against this file, not the cwd: run from the repo root and the
  // relative read threw ENOENT and killed the whole suite mid-run.
  const here = new URL("./comfy-install.mjs", import.meta.url);
  const src = await import("node:fs").then((fs) => fs.readFileSync(here, "utf8"));
  check("every workflow model has a download", () => {
    for (const [slot, file] of Object.entries(MODELS)) {
      assert.ok(src.includes("MODELS." + slot), `no download entry for MODELS.${slot} (${file})`);
    }
  });
}

// Quire's tools reach the CLIs as an MCP server, so the server itself has to
// answer a full round trip: handshake, catalogue, call. Driven directly over
// stdio rather than through a model, so it costs nothing and cannot flake.
{
  const { spawn } = await import("node:child_process");
  const here = new URL("./mcp-server.mjs", import.meta.url);
  const rpc = await new Promise((resolve, reject) => {
    const proc = spawn(process.execPath, [here.pathname.replace(/^\/([A-Za-z]:)/, "$1")], {
      stdio: ["pipe", "pipe", "ignore"],
    });
    let out = "";
    proc.stdout.on("data", (d) => { out += d; });
    proc.on("error", reject);
    proc.on("close", () => {
      const byId = new Map();
      for (const line of out.trim().split(/\r?\n/)) {
        if (!line.trim()) continue;
        try { const m = JSON.parse(line); byId.set(m.id, m); } catch {}
      }
      resolve(byId);
    });
    for (const msg of [
      { jsonrpc: "2.0", id: 1, method: "initialize", params: {} },
      { jsonrpc: "2.0", id: 2, method: "tools/list", params: {} },
      { jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "quire_image_backend_status", arguments: {} } },
      { jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "no_such_tool", arguments: {} } },
    ]) proc.stdin.write(JSON.stringify(msg) + "\n");
    proc.stdin.end();
  });

  check("mcp server completes the handshake", () =>
    assert.equal(rpc.get(1)?.result?.serverInfo?.name, "quire"));
  check("mcp server lists its tools", () => {
    const names = (rpc.get(2)?.result?.tools ?? []).map((t) => t.name);
    for (const want of ["quire_generate_image", "quire_read_publication"]) {
      assert.ok(names.includes(want), `missing tool ${want}`);
    }
  });
  check("mcp tool call returns content", () => {
    const text = rpc.get(3)?.result?.content?.[0]?.text;
    assert.ok(text && JSON.parse(text), "no parseable tool result");
  });
  check("mcp rejects an unknown tool", () =>
    assert.ok(rpc.get(4)?.error, "unknown tool should be an error"));
}

await Promise.all(pending);

console.log(failures ? `\n${failures} failing check(s)` : "\nall checks passed");
process.exit(failures ? 1 : 0);
