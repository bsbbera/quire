#!/usr/bin/env node
// Unit checks for what the shim reads out of a CLI's own reporting.
// Offline: every line here is a real one, captured from the CLIs themselves.
import assert from "node:assert/strict";
import { collectMeta, newMeta, usageBody } from "./usage.mjs";

let failures = 0;
const check = (name, fn) => {
  try { fn(); console.log(`  ok   ${name}`); }
  catch (e) { failures++; console.log(`  FAIL ${name}: ${e.message}`); }
};

// Captured from: claude -p --output-format stream-json --verbose
const CLAUDE_RESULT = JSON.stringify({
  type: "result", subtype: "success", is_error: false, num_turns: 3,
  duration_ms: 8120, duration_api_ms: 6400, total_cost_usd: 0.0231,
  usage: {
    input_tokens: 1200, output_tokens: 340,
    cache_creation_input_tokens: 90, cache_read_input_tokens: 4100,
    server_tool_use: { web_search_requests: 2, web_fetch_requests: 0 },
  },
  modelUsage: { "claude-sonnet-4-6": { inputTokens: 1200, outputTokens: 340 } },
});

// Captured from: codex exec --json
const CODEX_TURN = JSON.stringify({
  type: "turn.completed",
  usage: {
    input_tokens: 19557, cached_input_tokens: 9984, cache_write_input_tokens: 0,
    output_tokens: 5, reasoning_output_tokens: 0,
  },
});

check("reads claude's result event", () => {
  const m = newMeta();
  collectMeta("claude-json", CLAUDE_RESULT, m);
  assert.equal(m.reported, true);
  assert.equal(m.input, 1200);
  assert.equal(m.output, 340);
  assert.equal(m.cacheRead, 4100);
  assert.equal(m.cacheWrite, 90);
  assert.equal(m.webSearches, 2);
  assert.equal(m.turns, 3);
  assert.equal(m.costUsd, 0.0231);
  assert.deepEqual(m.byModel["claude-sonnet-4-6"], { input: 1200, output: 340 });
});

check("reads codex's turn.completed", () => {
  const m = newMeta();
  collectMeta("codex-json", CODEX_TURN, m);
  assert.equal(m.reported, true);
  assert.equal(m.input, 19557);
  assert.equal(m.output, 5);
  assert.equal(m.cacheRead, 9984);
});

check("a CLI that reports nothing is not reported as zero", () => {
  // devin speaks ACP and sends no token counts; agy is plain text. A zero here
  // would read as a measured zero on the usage panel, which is a lie.
  const m = newMeta();
  collectMeta("plain", "some prose", m);
  collectMeta("acp", JSON.stringify({ method: "session/update" }), m);
  assert.equal(m.reported, false);
  assert.equal(usageBody(m).x_quire.reported, false);
});

check("ignores every line that is not the final one", () => {
  const m = newMeta();
  collectMeta("claude-json", JSON.stringify({ type: "assistant", message: {} }), m);
  collectMeta("claude-json", "not json at all", m);
  assert.equal(m.reported, false);
});

check("carries the API failure claude only reports at the end", () => {
  // The CLI exits 0 on an auth failure and says so only in `result`.
  const m = newMeta();
  collectMeta("claude-json", JSON.stringify({ type: "result", api_error_status: 401, usage: {} }), m);
  assert.deepEqual(m.error, { kind: "api", status: 401 });
});

check("sums a turn that crossed two calls", () => {
  const m = newMeta();
  collectMeta("claude-json", CLAUDE_RESULT, m);
  collectMeta("claude-json", CLAUDE_RESULT, m);
  assert.equal(m.input, 2400);
  assert.equal(usageBody(m).total_tokens, 2400 + 680);
});

check("omits what the provider never said", () => {
  // No cost, no cache, no timings: the field is absent, not zero.
  const m = newMeta();
  collectMeta("codex-json", CODEX_TURN, m);
  const x = usageBody(m).x_quire;
  assert.equal("cost_usd" in x, false);
  assert.equal("web_searches" in x, false);
  assert.equal(x.cache_read_tokens, 9984);
});

console.log(failures ? `\n${failures} failed` : "\nall passed");
process.exit(failures ? 1 : 0);
