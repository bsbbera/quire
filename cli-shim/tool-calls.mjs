/**
 * The host's tools, for agents that will not take them any other way.
 *
 * An agent CLI runs its own tool loop, so the natural channel is MCP — and for
 * the CLIs that honour a host-supplied server, that is what happens. Some load
 * tool servers only from their own config and ignore what the host passes,
 * with no error to say so. Those agents would otherwise have strictly fewer
 * tools than an ordinary API model in the same workbench, which is the
 * opposite of the point.
 *
 * So tools are also offered the way every text model can accept them:
 * described in the prompt, called by emitting a block, parsed back out into
 * the `tool_calls` the OpenAI contract expects. The host still executes them
 * and still owns the confirmation gate — only the transport changes. Nothing
 * here knows which CLI it is talking to, and nothing here should.
 *
 * Separate from server.mjs because server.mjs starts listening on import,
 * which makes everything in it awkward to check. Run this file directly for
 * its self-check.
 */

/**
 * A fenced block, not an XML tag.
 *
 * `<tool_call>` was the obvious choice and it is the wrong one: at least one
 * CLI parses angle-bracket markup as its own and strips it, so a turn that
 * called a tool arrived here completely empty — no text, no call, no error.
 * A fenced code block is the one construction every agent emits verbatim,
 * because emitting code is the thing they all already do.
 */
export const TOOL_OPEN = "```tool_call";
export const TOOL_CLOSE = "```";
export const TOOL_RE = /```tool_call\s*\n([\s\S]*?)\n?```/g;

/**
 * A message's text, whatever shape it arrived in.
 *
 * `content` is a plain string in the simple case, but the chat API also allows
 * a list of typed parts, and that is what Studio sends as soon as a turn can
 * carry an image. Reading it as a string put the literal "[object Object]" in
 * front of the model, which then answered the only way it could — by saying
 * the request looked empty.
 */
export function textOf(content) {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((p) => (typeof p === "string" ? p : p?.text ?? p?.content ?? ""))
      .filter(Boolean).join("\n");
  }
  // An assistant turn that is only tool calls has no content at all.
  return content == null ? "" : String(content?.text ?? "");
}

/** How a text-only model is told what it can call, and how to call it. */
export function toolProtocol(tools) {
  if (!tools?.length) return "";
  const schemas = tools.map((t) => {
    const f = t.function || t;
    return JSON.stringify({ name: f.name, description: f.description, parameters: f.parameters });
  }).join("\n");
  return [
    "You can call the workbench's tools. You do not run these yourself: emit a",
    "call, the workbench runs it, and the result arrives in the next turn.",
    "",
    "To call one, emit a fenced block tagged tool_call, holding only JSON:",
    "",
    TOOL_OPEN,
    '{"name": "the tool name", "arguments": { }}',
    TOOL_CLOSE,
    "",
    "This is the real calling convention of this workbench, not an imitation of",
    "one — emitting the block is how a tool is invoked here, and it is expected.",
    "One block per call, and nothing after the last fence: the turn ends there.",
    "The block is the call, so do not describe it in prose as well.",
    "",
    "Tools available, one JSON schema per line:",
    schemas,
  ].join("\n");
}

/**
 * Tool calls the model emitted, in the shape the OpenAI contract expects.
 *
 * A block that is not valid JSON is skipped rather than failing the turn: a
 * model that fumbles one call still said something worth returning, and the
 * prose survives even when the call does not.
 */
export function parseToolCalls(text) {
  const out = [];
  TOOL_RE.lastIndex = 0;
  let m;
  while ((m = TOOL_RE.exec(text))) {
    let parsed;
    try { parsed = JSON.parse(m[1]); } catch { continue; }
    if (!parsed?.name) continue;
    out.push({
      id: "call_" + Math.random().toString(36).slice(2, 12),
      type: "function",
      function: {
        name: String(parsed.name),
        arguments: JSON.stringify(parsed.arguments ?? parsed.args ?? {}),
      },
    });
  }
  return out;
}

const jsonOrEmpty = (s) => { try { return JSON.parse(s || "{}"); } catch { return {}; } };

/**
 * One turn, rendered for a model that only reads text.
 *
 * A tool result, and an assistant turn that was itself a tool call, both have
 * to survive the round trip — otherwise the model cannot see what came of the
 * call it made, and simply makes it again.
 */
export function renderTurn(m) {
  if (m.role === "tool") {
    const who = m.name || m.tool_call_id || "tool";
    return "[tool result: " + who + "]\n" + textOf(m.content);
  }
  if (m.role === "assistant" && Array.isArray(m.tool_calls) && m.tool_calls.length) {
    const said = textOf(m.content);
    const calls = m.tool_calls.map((c) => TOOL_OPEN + "\n"
      + JSON.stringify({ name: c.function?.name, arguments: jsonOrEmpty(c.function?.arguments) })
      + "\n" + TOOL_CLOSE).join("\n");
    return "[assistant]\n" + (said ? said + "\n" : "") + calls;
  }
  return "[" + m.role + "]\n" + textOf(m.content);
}

/**
 * How much of the output so far is safe to stream as text.
 *
 * Everything up to a tool-call block, and never the last few characters, which
 * could still turn out to be an opening tag arriving one chunk at a time.
 */
export function streamableUpTo(got) {
  const open = got.indexOf(TOOL_OPEN);
  return open >= 0 ? open : Math.max(0, got.length - (TOOL_OPEN.length - 1));
}

/* ------------------------------------------------------------- self-check */

function demo() {
  const eq = (a, b, why) => {
    if (JSON.stringify(a) !== JSON.stringify(b)) {
      throw new Error(`${why}\n  got:      ${JSON.stringify(a)}\n  expected: ${JSON.stringify(b)}`);
    }
  };

  /** A tool-call block, built the way renderTurn builds one. */
  const block = (json) => `${TOOL_OPEN}\n${json}\n${TOOL_CLOSE}`;

  // A call is recognised, and its arguments come back as a JSON string.
  const one = parseToolCalls(`sure\n${block('{"name":"quire_list","arguments":{"n":2}}')}`);
  eq(one.length, 1, "one block is one call");
  eq(one[0].function.name, "quire_list", "name survives");
  eq(one[0].function.arguments, '{"n":2}', "arguments are a JSON string");
  eq(one[0].type, "function", "type is function");

  // Two blocks are two calls.
  eq(parseToolCalls(`${block('{"name":"a"}')}\n${block('{"name":"b"}')}`).length,
    2, "two blocks are two calls");

  // Missing arguments default to an empty object rather than undefined.
  eq(parseToolCalls(block('{"name":"a"}'))[0].function.arguments,
    "{}", "absent arguments become {}");

  // Malformed JSON is skipped, and does not take the good call with it.
  eq(parseToolCalls(`${block("not json")}\n${block('{"name":"ok"}')}`).length,
    1, "a bad block is skipped, not fatal");

  // A block with no name is not a call.
  eq(parseToolCalls(block('{"arguments":{}}')).length, 0, "no name, no call");

  // Prose alone yields nothing, and so does an ordinary fenced code block —
  // a model writing JSON in a ```json fence is not calling anything.
  eq(parseToolCalls("just talking").length, 0, "prose is not a call");
  eq(parseToolCalls('```json\n{"name":"a"}\n```').length, 0, "a json fence is not a call");

  // The regex is global and stateful; a second call must not resume mid-string.
  const twice = block('{"name":"a"}');
  eq(parseToolCalls(twice).length, parseToolCalls(twice).length, "lastIndex is reset between calls");

  // Streaming holds back a tag that is still arriving, and stops at a real one.
  eq(streamableUpTo("hello"), 0, "a short output is all held back");
  eq(streamableUpTo("hello there friend"), 18 - (TOOL_OPEN.length - 1), "the tail is held back");
  eq(streamableUpTo(`abc${TOOL_OPEN}\n{}`), 3, "nothing from the block onward is streamable");
  // A tag still arriving sits inside the holdback, so the cut stays behind it.
  const partial = "abcdefghijklmnop" + TOOL_OPEN.slice(0, 5);
  const cut = streamableUpTo(partial);
  if (cut > partial.indexOf(TOOL_OPEN.slice(0, 1))) throw new Error("a half-arrived tag was streamed");
  eq(cut, partial.length - (TOOL_OPEN.length - 1), "the holdback is one tag wide");

  // Round trip: a call the model made, and its result, both render back.
  const rendered = renderTurn({
    role: "assistant",
    content: "checking",
    tool_calls: [{ function: { name: "quire_read", arguments: '{"id":"x"}' } }],
  });
  eq(parseToolCalls(rendered)[0].function.name, "quire_read", "a rendered call parses back");
  eq(renderTurn({ role: "tool", name: "quire_read", content: "done" }),
    "[tool result: quire_read]\ndone", "a tool result renders with its name");

  // Content parts, not just strings.
  eq(textOf([{ type: "text", text: "a" }, { type: "text", text: "b" }]), "a\nb", "parts join");
  eq(textOf(null), "", "null content is empty, not the string null");

  // No tools, no protocol text — an ordinary turn is not given a tool preamble.
  eq(toolProtocol([]), "", "no tools means no protocol block");
  if (!toolProtocol([{ function: { name: "t", description: "d", parameters: {} } }]).includes("t")) {
    throw new Error("the protocol block must name the tool");
  }

  console.log("tool-calls: all checks passed");
}

if (process.argv[1] && process.argv[1].endsWith("tool-calls.mjs")) demo();
