// ComfyUI workflows, as data.
//
// The graph used to be eleven nodes transcribed into comfy.mjs, which meant a
// second workflow was a code change and the installer had to be told, in a
// separate list, which files that graph needed. A workflow is now one JSON
// file that carries its own graph, its own weights and their download URLs,
// and the settings to run it at three sizes. Adding one is a file, not a diff.
//
// Builtin workflows ship beside this file and cannot be deleted. User
// workflows live in the workspace, win on an id clash, and a malformed one is
// a diagnostic rather than a crash — the same rule the publication registry
// follows, for the same reason: these files are user-writable.
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { root } from "./workspace.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const BUILTIN_DIR = join(HERE, "workflows");

// One owner for the answer — the same folder Settings picks and the workbench
// opens, rather than a third independent copy of the same expression.
export const WORKSPACE = root();

const USER_DIR = join(WORKSPACE, "workflows");
const CONFIG = join(WORKSPACE, ".quire", "comfy.json");

/** Everything a workflow must carry before it can be run or installed. */
export function validate(w) {
  const problems = [];
  if (!w || typeof w !== "object") return ["not an object"];
  if (!w.id || !/^[a-z0-9][a-z0-9-]*$/.test(w.id)) problems.push("id must be lowercase kebab-case");
  if (!w.label) problems.push("label is required");
  if (!w.graph || typeof w.graph !== "object") problems.push("graph is required");
  if (!Array.isArray(w.models)) problems.push("models must be an array");
  else {
    for (const m of w.models) {
      // Test 5.7 lived in test.mjs as a grep over the installer's source. It is
      // a structural rule now: a model with no URL is a render that fails only
      // on a machine that did not happen to already have the file.
      if (!m.slot || !m.file || !m.sub) problems.push(`model ${JSON.stringify(m)} needs slot, sub and file`);
      if (!m.url) problems.push(`model ${m.file || "?"} has no download URL`);
    }
  }
  if (!w.settings?.gpu && !w.settings?.cpu) problems.push("settings needs at least gpu or cpu");
  return problems;
}

function readDir(dir, source) {
  if (!existsSync(dir)) return { workflows: [], diagnostics: [] };
  const workflows = [];
  const diagnostics = [];
  for (const name of readdirSync(dir)) {
    if (!name.endsWith(".json")) continue;
    const file = join(dir, name);
    try {
      const parsed = JSON.parse(readFileSync(file, "utf-8"));
      const problems = validate(parsed);
      if (problems.length) { diagnostics.push({ file, problems }); continue; }
      workflows.push({ ...parsed, source, file, builtin: source === "builtin" });
    } catch (e) {
      diagnostics.push({ file, problems: [e.message] });
    }
  }
  return { workflows, diagnostics };
}

export function list() {
  const builtin = readDir(BUILTIN_DIR, "builtin");
  const user = readDir(USER_DIR, "user");
  const byId = new Map(builtin.workflows.map((w) => [w.id, w]));
  // A user file with a builtin's id overrides it, but stays deletable: what it
  // shadows is still on disk, so removing it falls back rather than breaking.
  for (const w of user.workflows) byId.set(w.id, w);
  return {
    workflows: [...byId.values()],
    diagnostics: [...builtin.diagnostics, ...user.diagnostics],
  };
}

export const find = (id) => list().workflows.find((w) => w.id === id);

/* ------------------------------------------------------------------ config */
// One small file: which workflow is selected, which device was chosen for this
// machine, and what the benchmark measured. Read on every call rather than
// cached, because the installer and the UI both write it.
export function config() {
  try { return JSON.parse(readFileSync(CONFIG, "utf-8")); } catch { return {}; }
}

export function saveConfig(patch) {
  const next = { ...config(), ...patch };
  mkdirSync(dirname(CONFIG), { recursive: true });
  writeFileSync(CONFIG, JSON.stringify(next, null, 2), "utf-8");
  return next;
}

/** The workflow in force: the selected one, else the first builtin. */
export function selected() {
  const all = list().workflows;
  return all.find((w) => w.id === config().workflow) || all.find((w) => w.builtin) || all[0];
}

export function select(id) {
  if (!find(id)) throw new Error("no workflow " + id);
  return saveConfig({ workflow: id });
}

/** Add a user workflow. Validated before it lands, so a bad paste never sticks. */
export function add(workflow) {
  const problems = validate(workflow);
  if (problems.length) throw new Error("invalid workflow: " + problems.join("; "));
  mkdirSync(USER_DIR, { recursive: true });
  const file = join(USER_DIR, workflow.id + ".json");
  writeFileSync(file, JSON.stringify(workflow, null, 2), "utf-8");
  return { ...workflow, source: "user", file, builtin: false };
}

export function remove(id) {
  const w = find(id);
  if (!w) throw new Error("no workflow " + id);
  // The default is the fallback for every other failure; deleting it leaves a
  // machine that can install ComfyUI and then not use it.
  if (w.source === "builtin") throw new Error(w.label + " is the built-in workflow and cannot be deleted");
  rmSync(w.file, { force: true });
  if (config().workflow === id) saveConfig({ workflow: null });
  return { removed: id };
}

/* --------------------------------------------------------------- rendering */
/**
 * Fill a workflow's graph with run values.
 *
 * A placeholder alone in a string becomes the raw value, so {{width}} stays a
 * number — ComfyUI rejects "1536" where it wants 1536. Embedded placeholders
 * interpolate as text. A name with no value renders empty rather than throwing,
 * because these files are user-written.
 */
export function fill(value, values) {
  if (typeof value === "string") {
    const whole = /^\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}$/.exec(value);
    if (whole) return values[whole[1]] ?? "";
    return value.replace(/\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}/g, (_, k) => String(values[k] ?? ""));
  }
  if (Array.isArray(value)) return value.map((v) => fill(v, values));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, fill(v, values)]));
  }
  return value;
}

/** The size/step settings for a device, falling back through the three tiers. */
export function settingsFor(workflow, device) {
  const s = workflow.settings || {};
  if (device === "cpu") return s.cpu || s.lowvram || s.gpu || {};
  if (device === "lowvram") return s.lowvram || s.gpu || s.cpu || {};
  return s.gpu || s.lowvram || s.cpu || {};
}

/** Model file names by slot, the shape comfy.mjs's graph placeholders expect. */
export const modelsBySlot = (workflow) =>
  Object.fromEntries((workflow.models || []).map((m) => ["model." + m.slot, m.file]));
