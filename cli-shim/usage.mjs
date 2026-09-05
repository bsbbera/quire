/**
 * Everything a CLI says about the turn besides the prose.
 *
 * The shim used to invent this: `Math.ceil(text.length / 4)`, sent as
 * `usage` on the non-streaming path and not sent at all when streaming — so a
 * chat, which streams, saw no usage ever, and a pipeline saw a guess wearing a
 * measurement's clothes. Both CLIs that can count actually do:
 *
 *   claude  `result` event → usage{input_tokens, output_tokens,
 *           cache_creation_input_tokens, cache_read_input_tokens,
 *           server_tool_use{web_search_requests}}, modelUsage (per model),
 *           total_cost_usd, num_turns, duration_ms, duration_api_ms
 *   codex   `turn.completed` → usage{input_tokens, cached_input_tokens,
 *           cache_write_input_tokens, output_tokens, reasoning_output_tokens}
 *   devin   ACP reports no token counts at all, and says so via `reported`
 *   agy     plain text; nothing to read
 *
 * `reported: false` is the point of this. A provider that does not count must
 * not be shown as having spent zero — the honest cell is blank.
 */
export function newMeta() {
  return { reported: false, input: 0, output: 0, cacheRead: 0, cacheWrite: 0,
           reasoning: 0, webSearches: 0, costUsd: null, turns: 0,
           durationMs: 0, apiMs: 0, byModel: {}, error: null };
}

const num = (v) => (typeof v === "number" && isFinite(v) ? v : 0);

export function collectMeta(stream, line, meta) {
  let m; try { m = JSON.parse(line); } catch { return; }

  if (stream === "claude-json" && m.type === "result") {
    const u = m.usage || {};
    meta.reported = true;
    meta.input += num(u.input_tokens);
    meta.output += num(u.output_tokens);
    meta.cacheRead += num(u.cache_read_input_tokens);
    meta.cacheWrite += num(u.cache_creation_input_tokens);
    meta.webSearches += num(u.server_tool_use?.web_search_requests);
    meta.turns += num(m.num_turns);
    meta.durationMs += num(m.duration_ms);
    meta.apiMs += num(m.duration_api_ms);
    if (typeof m.total_cost_usd === "number") meta.costUsd = (meta.costUsd || 0) + m.total_cost_usd;
    // claude bills per underlying model when a turn crosses more than one.
    for (const [id, mu] of Object.entries(m.modelUsage || {})) {
      const row = meta.byModel[id] || (meta.byModel[id] = { input: 0, output: 0 });
      row.input += num(mu.inputTokens ?? mu.input_tokens);
      row.output += num(mu.outputTokens ?? mu.output_tokens);
    }
    // The CLI exits 0 on an API failure and reports it only here.
    if (m.api_error_status) meta.error = { kind: "api", status: m.api_error_status };
    return;
  }

  if (stream === "codex-json" && m.type === "turn.completed") {
    const u = m.usage || {};
    meta.reported = true;
    meta.input += num(u.input_tokens);
    meta.output += num(u.output_tokens);
    meta.cacheRead += num(u.cached_input_tokens);
    meta.cacheWrite += num(u.cache_write_input_tokens);
    meta.reasoning += num(u.reasoning_output_tokens);
    meta.turns += 1;
  }
}

/** The OpenAI shape, plus what OpenAI has no field for. */
export function usageBody(meta) {
  const extra = {
    reported: meta.reported,
    ...(meta.cacheRead ? { cache_read_tokens: meta.cacheRead } : {}),
    ...(meta.cacheWrite ? { cache_write_tokens: meta.cacheWrite } : {}),
    ...(meta.reasoning ? { reasoning_tokens: meta.reasoning } : {}),
    ...(meta.webSearches ? { web_searches: meta.webSearches } : {}),
    ...(meta.costUsd !== null ? { cost_usd: meta.costUsd } : {}),
    ...(meta.turns ? { turns: meta.turns } : {}),
    ...(meta.durationMs ? { duration_ms: meta.durationMs } : {}),
    ...(meta.apiMs ? { api_ms: meta.apiMs } : {}),
    ...(Object.keys(meta.byModel).length ? { by_model: meta.byModel } : {}),
    ...(meta.error ? { error: meta.error } : {}),
  };
  return {
    prompt_tokens: meta.input,
    completion_tokens: meta.output,
    total_tokens: meta.input + meta.output,
    x_quire: extra,
  };
}

