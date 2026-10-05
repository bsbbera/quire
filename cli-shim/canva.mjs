// Canva as a second image engine.
//
// Canva has two halves and Quire needs both: the Connect REST API can export a
// design to PNG but cannot *make* a picture from a sentence, and the picture
// maker (Canva AI / Magic Media) is only reachable as a tool on Canva's remote
// MCP endpoint. So this file speaks JSON-RPC over HTTP to mcp.canva.com to get
// a design, then REST to api.canva.com to get pixels out of it.
//
// There is no API that reports the remaining AI allowance, so exhaustion can
// only be seen as an error on a call that was going to be made anyway. Reading
// that error correctly is what makes the fallback in engines.mjs honest —
// everything else about Canva is optional, this part is not.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { WORKSPACE } from "./workflows.mjs";

const MCP_URL = process.env.CANVA_MCP_URL || "https://mcp.canva.com/mcp";
const API_URL = process.env.CANVA_API_URL || "https://api.canva.com/rest/v1";

/**
 * The access token, from the same secrets file the Studio already writes.
 *
 * Canva is OAuth-only upstream, but the token is what every call actually
 * carries, so the app accepts a pasted token and leaves the authorisation
 * dance to the browser the user already signed into. One less redirect server
 * to run, and nothing here changes if a real OAuth flow lands later.
 */
export function token() {
  if (process.env.CANVA_TOKEN) return process.env.CANVA_TOKEN.trim();
  const file = join(WORKSPACE, ".quire", "secrets.json");
  if (!existsSync(file)) return "";
  try {
    const all = JSON.parse(readFileSync(file, "utf8"));
    return String(all?.services?.canva?.apiKey || "").trim();
  } catch { return ""; }
}

export const connected = () => Boolean(token());

/**
 * Is this failure Canva saying "you are out of allowance"?
 *
 * Canva does not expose a machine-readable quota code, so the text is the
 * signal. Being wrong in the cautious direction is cheap — a misread error
 * routes one picture to ComfyUI — while missing it would fail the whole job.
 */
export function isQuotaError(status, message) {
  const m = String(message || "").toLowerCase();
  if (/quota|allowance|limit reached|usage limit|out of credits|insufficient credit|too many requests/.test(m)) return true;
  return status === 429 || status === 402;
}

class CanvaError extends Error {
  constructor(message, status) {
    super(message);
    this.name = "CanvaError";
    this.status = status;
    this.quota = isQuotaError(status, message);
  }
}

async function rest(path, { method = "GET", body, signal } = {}) {
  const key = token();
  if (!key) throw new CanvaError("Canva is not connected — add a Canva token in Connections", 401);
  const res = await fetch(`${API_URL}${path}`, {
    method,
    headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
    ...(body ? { body: JSON.stringify(body) } : {}),
    ...(signal ? { signal } : {}),
  });
  const text = await res.text();
  let data = {};
  try { data = text ? JSON.parse(text) : {}; } catch { data = { message: text }; }
  if (!res.ok) throw new CanvaError(data.message || data.error || `Canva HTTP ${res.status}`, res.status);
  return data;
}

/**
 * One tool call on Canva's remote MCP endpoint.
 *
 * Streamable-HTTP MCP is a POST per message; the endpoint answers either JSON
 * or an SSE frame carrying the same JSON, so both are unwrapped here. The shim
 * MCP hub next door is stdio-only, which is why this does not go through it.
 */
async function mcpCall(name, args, { signal } = {}) {
  const key = token();
  if (!key) throw new CanvaError("Canva is not connected — add a Canva token in Connections", 401);
  const res = await fetch(MCP_URL, {
    method: "POST",
    headers: {
      authorization: `Bearer ${key}`,
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
    },
    body: JSON.stringify({
      jsonrpc: "2.0", id: Date.now(), method: "tools/call",
      params: { name, arguments: args },
    }),
    ...(signal ? { signal } : {}),
  });
  const text = await res.text();
  if (!res.ok) throw new CanvaError(textError(text) || `Canva MCP HTTP ${res.status}`, res.status);
  const payload = parseRpc(text);
  if (payload?.error) throw new CanvaError(payload.error.message || "Canva MCP call failed", res.status);
  const result = payload?.result ?? {};
  if (result.isError) throw new CanvaError(textOf(result) || "Canva MCP call failed", res.status);
  return result;
}

/** SSE frames carry the same JSON body as a plain answer; take whichever came. */
function parseRpc(text) {
  const body = String(text || "").trim();
  if (!body) return null;
  if (body.startsWith("{")) { try { return JSON.parse(body); } catch { return null; } }
  for (const line of body.split(/\r?\n/)) {
    if (!line.startsWith("data:")) continue;
    const chunk = line.slice(5).trim();
    if (!chunk || chunk === "[DONE]") continue;
    try { return JSON.parse(chunk); } catch { /* next frame */ }
  }
  return null;
}

function textOf(result) {
  return (result?.content || []).filter((c) => c?.type === "text").map((c) => c.text).join("\n").trim();
}

function textError(text) {
  const rpc = parseRpc(text);
  return rpc?.error?.message || (rpc?.result ? textOf(rpc.result) : "");
}

/** The design id is wherever Canva put it — structured content, or in the prose. */
function designIdOf(result) {
  const direct = result?.structuredContent?.design?.id || result?.structuredContent?.design_id;
  if (direct) return String(direct);
  const found = /\b(?:DA[A-Za-z0-9_-]{6,})\b/.exec(textOf(result));
  return found ? found[1] : "";
}

/**
 * Make one picture: prompt in, PNG bytes out.
 *
 * Canva has no negative prompt, so the policy's "not this" list is folded into
 * the positive as plain English by the caller. No seed either — the recipe
 * records `reproducible: false` so the gallery offers a re-prompt rather than
 * an exact remake it cannot deliver.
 */
export async function generate({
  prompt, width = 1024, height = 1024, transparent = false,
  timeoutMs = 300000, signal, onProgress,
} = {}) {
  if (!prompt) throw new CanvaError("prompt required", 400);
  const started = Date.now();
  const side = Math.min(2048, Math.max(width, height));
  const scale = side > 2048 ? 2048 / side : 1;
  const w = Math.round(width * scale);
  const h = Math.round(height * scale);

  onProgress?.("Canva: asking for a design…");
  const made = await mcpCall("generate-design", {
    prompt,
    design_type: { type: "custom", width: w, height: h },
  }, { signal });
  const designId = designIdOf(made);
  if (!designId) throw new CanvaError("Canva did not return a design id", 502);

  onProgress?.("Canva: exporting…");
  const job = await rest("/exports", {
    method: "POST",
    body: {
      design_id: designId,
      format: { type: "png", ...(transparent ? { transparent_background: true } : {}) },
    },
    signal,
  });
  let id = job?.job?.id;
  let urls = job?.job?.urls || [];
  let status = job?.job?.status || "in_progress";
  while (id && status === "in_progress") {
    if (Date.now() - started > timeoutMs) throw new CanvaError("Canva export timed out", 504);
    await new Promise((r) => setTimeout(r, 1500));
    const next = await rest(`/exports/${id}`, { signal });
    status = next?.job?.status || "failed";
    urls = next?.job?.urls || urls;
    if (status === "failed") throw new CanvaError(next?.job?.error?.message || "Canva export failed", 502);
  }
  if (!urls.length) throw new CanvaError("Canva export produced no file", 502);

  const file = await fetch(urls[0], signal ? { signal } : {});
  if (!file.ok) throw new CanvaError(`Canva download HTTP ${file.status}`, file.status);
  const buf = Buffer.from(await file.arrayBuffer());
  return { buf, designId, width: w, height: h, ms: Date.now() - started };
}

export { CanvaError };
