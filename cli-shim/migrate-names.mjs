// The names Quire inherited from InkOS, moved to its own, once.
//
// Every other file reads the new names only: `.quire/` for app state,
// `quire.json` for the workspace config, `QUIRE_*` for settings, and
// `research/` for gathered pages. This is the one place that still knows the
// old ones, so a workspace written by an older build opens with its sessions,
// config and research intact.
//
// Nothing is overwritten. Where both names already hold the same entry, the
// old one is left where it is and named in the log.
//
//   node --test cli-shim/migrate-names.test.mjs
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmdirSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const OLD_DIR = ".inkos";
const OLD_CONFIG = "inkos.json";

export function migrateNames(root, home = homedir()) {
  const log = [];
  const old = join(root, OLD_DIR);

  if (existsSync(old)) {
    // Gathered pages were hidden inside the state folder. They are the
    // person's research, kept for later, so they sit in the workspace itself.
    const materials = join(old, "materials");
    if (existsSync(materials)) {
      const research = join(root, "research");
      mkdirSync(research, { recursive: true });
      for (const name of readdirSync(materials)) {
        const from = join(materials, name);
        const to = join(research, name);
        if (existsSync(to)) { log.push(`kept ${OLD_DIR}/materials/${name}: research/${name} exists`); continue; }
        if (name.endsWith(".json")) {
          // A manifest records where its own files are.
          writeFileSync(to, readFileSync(from, "utf-8").replaceAll(`${OLD_DIR}/materials/`, "research/"));
          rmSync(from);
        } else {
          renameSync(from, to);
        }
      }
      removeIfEmpty(materials);
      log.push("research pages moved to research/");
    }

    const state = join(root, ".quire");
    mkdirSync(state, { recursive: true });
    for (const name of readdirSync(old)) {
      const to = join(state, name);
      if (existsSync(to)) { log.push(`kept ${OLD_DIR}/${name}: .quire/${name} exists`); continue; }
      renameSync(join(old, name), to);
    }
    if (removeIfEmpty(old)) log.push(`${OLD_DIR}/ moved to .quire/`);
  }

  const oldConfig = join(root, OLD_CONFIG);
  if (existsSync(oldConfig) && !existsSync(join(root, "quire.json"))) {
    renameSync(oldConfig, join(root, "quire.json"));
    log.push(`${OLD_CONFIG} renamed to quire.json`);
  }

  // Copied, not moved: an installed build that predates this still reads the
  // old home folder, and taking it away would break that build.
  const oldHome = join(home, OLD_DIR);
  const newHome = join(home, ".quire");
  if (existsSync(oldHome)) {
    mkdirSync(newHome, { recursive: true });
    for (const name of readdirSync(oldHome)) {
      const to = join(newHome, name);
      if (existsSync(to)) continue;
      cpSync(join(oldHome, name), to, { recursive: true });
      log.push(`~/${OLD_DIR}/${name} copied to ~/.quire/`);
    }
  }

  for (const env of [join(root, ".env"), join(newHome, ".env")]) {
    if (renameEnvKeys(env)) log.push(`INKOS_ keys renamed to QUIRE_ in ${env}`);
  }
  return log;
}

/** `INKOS_X=` becomes `QUIRE_X=`, commented lines included. Values are untouched. */
export function renameEnvKeys(file) {
  if (!existsSync(file)) return false;
  const text = readFileSync(file, "utf-8");
  const next = text.replace(/^(\s*#?\s*(?:export\s+)?)INKOS_/gm, "$1QUIRE_");
  if (next === text) return false;
  writeFileSync(file, next);
  return true;
}

function removeIfEmpty(dir) {
  if (readdirSync(dir).length) return false;
  rmdirSync(dir);
  return true;
}
