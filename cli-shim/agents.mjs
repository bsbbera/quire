// Which agent CLIs this machine is allowed to use.
//
// Detection alone is not consent. A machine can have four CLIs on it and the
// user may want Quire to touch one of them — each turn spends that account's
// quota, so the choice has to be theirs and it has to be remembered.
//
// Deliberately machine-level, not per-project: which CLIs are installed and
// signed in is a fact about this computer, and moving the workspace to another
// folder must not silently re-enable a CLI the user turned off.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const CONFIG_DIR = join(homedir(), ".quire");
const CONFIG = join(CONFIG_DIR, "agents.json");

function read() {
  try { return JSON.parse(readFileSync(CONFIG, "utf-8")); } catch { return {}; }
}

/**
 * Detected and not switched off. Only an explicit `false` disables a CLI, so a
 * machine that has never opened the panel keeps every CLI it already had — an
 * upgrade must not wake up with no models — while a newly installed CLI is
 * offered rather than ignored.
 */
export function isEnabled(id) {
  return read()[id] !== false;
}

export function setEnabled(id, on) {
  const cfg = read();
  cfg[id] = !!on;
  mkdirSync(CONFIG_DIR, { recursive: true });
  writeFileSync(CONFIG, JSON.stringify(cfg, null, 2), "utf-8");
  return cfg;
}

export function all() {
  return read();
}
