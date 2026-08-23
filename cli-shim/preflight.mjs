// What a fresh machine is missing, and what to do about it.
//
// Nothing here installs anything. Two of the four dependencies *cannot* be
// installed by us — Affinity is a licensed app and ComfyUI's checkpoints are
// tens of gigabytes — so an auto-installer would be a lie that fails halfway.
// A check that names the gap and the fix is the honest version, and it is the
// same panel that then goes green when the user has done it.
// ponytail: no installer. Add one only for a dependency we can legally ship.
import { execFile } from "node:child_process";
import { accessSync, constants, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { MODELS } from "./comfy.mjs";

const HOME = homedir();
const WIN = process.platform === "win32";

/** Does this command exist on PATH? Resolves to its path, or null. */
function which(cmd) {
  return new Promise((res) => {
    execFile(WIN ? "where" : "which", [cmd], { windowsHide: true }, (err, out) => {
      res(err ? null : String(out).split(/\r?\n/)[0].trim() || null);
    });
  });
}

const ok = (id, label, detail) => ({ id, label, ok: true, detail });
const bad = (id, label, detail, fix, severity = "required") =>
  ({ id, label, ok: false, severity, detail, fix });

async function nodeCheck() {
  const major = Number(process.versions.node.split(".")[0]);
  return major >= 18
    ? ok("node", "Node.js", `v${process.versions.node}`)
    : bad("node", "Node.js", `v${process.versions.node} is too old`,
        "Install Node.js 18 or newer from nodejs.org, then restart InkDesk.");
}

async function inkosCheck() {
  const p = (await which("inkos")) || (await which("inkos.cmd"));
  return p
    ? ok("inkos", "InkOS CLI", p)
    : bad("inkos", "InkOS CLI", "not on PATH",
        "npm i -g inkos — Studio and the writing pipeline both call it.");
}

/** At least one agent CLI must exist; the shim serves whichever are present. */
async function agentCheck() {
  const names = ["claude", "codex", "devin", "antigravity"];
  const found = (await Promise.all(names.map(async (n) => ((await which(n)) ? n : null)))).filter(Boolean);
  return found.length
    ? ok("agents", "Model providers", found.join(", "))
    : bad("agents", "Model providers", "no agent CLI found",
        "Install at least one of: claude, codex, devin, antigravity. "
        + "The shim exposes their models; with none, nothing can be written.");
}

function writableCheck(magRoot) {
  try {
    accessSync(magRoot, constants.W_OK);
    return ok("workspace", "Workspace", magRoot);
  } catch {
    return bad("workspace", "Workspace", `cannot write to ${magRoot}`,
      "Set MAG_ROOT to a folder you own, or create that folder.");
  }
}

function comfyCheck(st) {
  if (st.up) return ok("comfy", "ComfyUI", `running at ${st.url}`);
  if (st.installed) {
    return bad("comfy", "ComfyUI", `installed at ${st.dir}, not running`,
      "Start it from the Integrations panel, or run run_nvidia_gpu.bat.", "optional");
  }
  return bad("comfy", "ComfyUI", "not found",
    "Without it, pages are written but have no artwork. Install the portable "
    + "build, then set COMFY_DIR if it is not on C: or D:.", "optional");
}

function comfyModelCheck(st) {
  if (!st.installed) return null;                 // nothing to say yet
  const dir = join(st.dir, "ComfyUI", "models");
  // Scan one level rather than guess the subfolder: this build keeps the UNET
  // under diffusion_models/ and the text encoder under text_encoders/, not the
  // unet/ and clip/ the node names imply, and a wrong guess reports a healthy
  // install as broken.
  let have = new Set();
  try {
    for (const sub of readdirSync(dir, { withFileTypes: true })) {
      if (!sub.isDirectory()) continue;
      try { for (const f of readdirSync(join(dir, sub.name))) have.add(f); } catch {}
    }
  } catch {
    return bad("comfy-models", "ComfyUI models", `cannot read ${dir}`,
      "Check the ComfyUI install, or set COMFY_DIR.", "optional");
  }
  const missing = Object.values(MODELS).filter((f) => !have.has(f));
  return missing.length
    ? bad("comfy-models", "ComfyUI models", `missing: ${missing.join(", ")}`,
        `Place them under ${dir}. Renders fail without them.`, "optional")
    : ok("comfy-models", "ComfyUI models", `all ${Object.keys(MODELS).length} present`);
}

function affinityCheck(st) {
  if (st.up && st.canRead) return ok("affinity", "Affinity", `v${st.version || "?"}, sandbox readable`);
  return bad("affinity", "Affinity", st.reason || "not connected",
    "Open Affinity and enable Settings > MCP Server. Without it, pages and art "
    + "are produced but no PDF is laid out.", "optional");
}

function mcpCheck(servers) {
  const n = Object.keys(servers || {}).length;
  return n
    ? ok("mcp", "MCP servers", `${n} discovered`)
    : bad("mcp", "MCP servers", "none discovered",
        "Configure servers in Claude Desktop, Claude Code or Codex and "
        + "they appear here automatically.");
}

/** Run every check. Each source is passed in so this file stays side-effect free. */
export async function doctor({ comfyStatus, affinityStatus, servers, magRoot }) {
  const checks = [
    await nodeCheck(),
    await inkosCheck(),
    await agentCheck(),
    writableCheck(magRoot),
    comfyCheck(comfyStatus),
    comfyModelCheck(comfyStatus),
    affinityCheck(affinityStatus),
    mcpCheck(servers),
  ].filter(Boolean);
  const blocking = checks.filter((c) => !c.ok && c.severity === "required");
  return { ok: !blocking.length, blocking: blocking.length, checks };
}
