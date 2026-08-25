/**
 * One harness. Every model a provider.
 *
 * A CLI is an agent runtime that happens to also be an LLM. That made it
 * tempting to let it keep its own tool loop, and for a while Quire did — the
 * shim handed each CLI a set of MCP servers at launch, and told it in the
 * prompt that it could shell out to the same tools as commands. Both worked,
 * in the sense that tools ran.
 *
 * They ran in the wrong place. A tool the CLI executes inside its own loop is
 * finished before the host hears about it: the host cannot gate it, cannot
 * record it, cannot refuse it. `quire_affinity_build` was reachable that way,
 * and it calls affinity.build() without the approval and spec checks the
 * runner enforces — so a magazine could be built having passed none of them.
 *
 * So there is one channel now, and this module is it. The host owns the tool
 * table. Tools arrive as `tools` on the request, are described to the model in
 * the prompt, come back as fenced blocks, are parsed into the tool_calls the
 * OpenAI contract expects, and are executed by the host with its gates intact.
 * A CLI model and an API model now differ in transport and in nothing else.
 *
 * What this costs: the CLI's own agentic abilities — its file editing, its
 * search, its planning — are no longer pointed at Quire's workspace. That is
 * the trade. An ungated capability is not a capability Quire can offer.
 */

import { parseToolCalls, renderTurn, textOf, toolProtocol, TOOL_RE, streamableUpTo }
  from "./tool-calls.mjs";

export { parseToolCalls, renderTurn, textOf, toolProtocol, TOOL_RE, streamableUpTo };

/**
 * Tool servers handed to a CLI at launch: none, deliberately.
 *
 * Every adapter asks this rather than building its own list, so there is one
 * place to look when asking "can the CLI run something we did not authorise",
 * and one place to change if that ever needs to be true again.
 *
 * QUIRE_CLI_OWN_TOOLS=1 restores the old behaviour for debugging a CLI in
 * isolation. It is not a supported configuration: turn it on and the host's
 * gates no longer cover everything the model can do.
 */
export const CLI_OWN_TOOLS = process.env.QUIRE_CLI_OWN_TOOLS === "1";

/** MCP servers for a CLI's own loop. Empty unless explicitly re-enabled. */
export function launchServers(agentId, discover) {
  if (!CLI_OWN_TOOLS) return {};
  const out = {};
  let discovered = {};
  try { discovered = discover?.() ?? {}; } catch { discovered = {}; }
  for (const [name, s] of Object.entries(discovered)) {
    if (!s.enabled || !s.command) continue;
    if (s.source === agentId) continue;
    out[name] = { command: s.command, args: s.args || [], env: s.env || {}, cwd: s.cwd };
  }
  return out;
}

/** The same list in ACP's shape: env as {name, value} pairs. */
export const launchServersAcp = (agentId, discover) =>
  Object.entries(launchServers(agentId, discover)).map(([name, s]) => ({
    name,
    command: s.command,
    args: s.args || [],
    env: Object.entries(s.env || {}).map(([k, v]) => ({ name: k, value: String(v) })),
  }));

/**
 * What the model is told when the host gave it no tools at all.
 *
 * Silence here is the expensive failure: asked to generate an image with no
 * tool to do it, a model writes a confident paragraph about having generated
 * one. Better it knows the table is empty and says so.
 */
const NO_TOOLS_NOTICE = [
  "You have no tools this turn. Anything requiring one — generating an image,",
  "reading or writing files, laying out or building a document — you cannot do.",
  "Say so plainly rather than describing work you did not perform.",
].join("\n");

/**
 * A CLI turn, assembled.
 *
 * System turns are hoisted and merged; everything else renders in order, with
 * tool calls and tool results both surviving the round trip so the model can
 * see what came of what it asked for.
 */
export function buildPrompt(messages, tools, options = {}) {
  const lang = options.language || "English";
  const msgs = Array.isArray(messages) ? messages : [];
  const table = Array.isArray(tools) ? tools : [];

  const system = msgs.filter((m) => m.role === "system")
    .map((m) => textOf(m.content)).filter(Boolean).join("\n");
  const turns = msgs.filter((m) => m.role !== "system")
    .map(renderTurn).filter(Boolean).join("\n\n");

  return [
    system,
    table.length ? toolProtocol(table) : NO_TOOLS_NOTICE,
    "Always respond in " + lang + ".",
    turns,
  ].filter(Boolean).join("\n\n");
}

/**
 * A finished turn, split into the parts the OpenAI contract wants.
 *
 * The block is machinery, not prose: with a call in hand the block comes out
 * of the text, because a client that renders it will also run the same call
 * when it arrives parsed, and the user sees the tool fire twice.
 */
export function finishTurn(got, tools) {
  const calls = tools?.length ? parseToolCalls(got) : [];
  const text = calls.length ? got.replace(TOOL_RE, "").trim() : got;
  return { calls, text, finish: calls.length ? "tool_calls" : "stop" };
}

/* ------------------------------------------------------------- self-check */

function demo() {
  const eq = (a, b, why) => {
    if (JSON.stringify(a) !== JSON.stringify(b)) {
      throw new Error(`${why}\n  got:      ${JSON.stringify(a)}\n  expected: ${JSON.stringify(b)}`);
    }
  };
  const tool = { function: { name: "comfy_generate", description: "make an image", parameters: {} } };

  // No CLI gets tool servers of its own.
  eq(launchServers("claude-code", () => ({ affinity: { enabled: true, command: "x" } })), {},
    "the CLI is handed no servers");
  eq(launchServersAcp("devin", () => ({ affinity: { enabled: true, command: "x" } })), [],
    "and none over ACP either");

  // The tool table reaches the model.
  const withTools = buildPrompt([{ role: "user", content: "hi" }], [tool]);
  if (!withTools.includes("comfy_generate")) throw new Error("the tool must be named in the prompt");
  if (!withTools.includes("```tool_call")) throw new Error("the calling convention must be stated");

  // An empty table is stated, not left silent.
  const noTools = buildPrompt([{ role: "user", content: "hi" }], []);
  if (!noTools.includes("no tools this turn")) throw new Error("an empty table must be declared");
  if (noTools.includes("```tool_call")) throw new Error("no convention when there is nothing to call");

  // System turns hoist above the tool protocol; the user turn stays below.
  const ordered = buildPrompt(
    [{ role: "system", content: "SYS" }, { role: "user", content: "USR" }], [tool]);
  if (!(ordered.indexOf("SYS") < ordered.indexOf("comfy_generate")
     && ordered.indexOf("comfy_generate") < ordered.indexOf("USR"))) {
    throw new Error("system, then tools, then the conversation");
  }

  // A call and its result both survive back into the next prompt.
  const round = buildPrompt([
    { role: "user", content: "make one" },
    { role: "assistant", content: "", tool_calls: [{ function: { name: "comfy_generate", arguments: "{}" } }] },
    { role: "tool", name: "comfy_generate", content: "/out/1.png" },
    { role: "user", content: "and again" },
  ], [tool]);
  if (!round.includes("/out/1.png")) throw new Error("the tool result must come back to the model");

  // A finished turn: block out of the prose, call in hand.
  const fin = finishTurn('sure\n```tool_call\n{"name":"comfy_generate","arguments":{}}\n```', [tool]);
  eq(fin.calls.length, 1, "the call is found");
  eq(fin.text, "sure", "the block is stripped from the prose");
  eq(fin.finish, "tool_calls", "the turn finishes as a tool call");

  // With no tool table, a block is just text the model wrote.
  eq(finishTurn('```tool_call\n{"name":"x"}\n```', []).finish, "stop", "no table, no calls");

  console.log("harness: all checks passed");
}

if (process.argv[1] && process.argv[1].endsWith("harness.mjs")) demo();
