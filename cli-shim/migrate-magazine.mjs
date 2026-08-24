#!/usr/bin/env node
// Move magazine issues from the old engine's store into the publication
// runner's.
//
// The old engine kept issues under MAG_ROOT/issues/<id>/issue.json; the runner
// keeps them under <workspace>/<outDir>/issues/<id>/publication.json. The two
// schemas are otherwise the same, so this is a copy plus the `type` field the
// runner needs to know which definition an issue belongs to.
//
// Copies, never moves: the original stays exactly where it is, so a migration
// that goes wrong costs nothing. Run it twice and it will refuse to overwrite.
//
//   node cli-shim/migrate-magazine.mjs [--force]
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const HOME = homedir();
const force = process.argv.includes("--force");

// The same search order the old engine used, so this finds whatever it wrote.
const MAG_ROOT = process.env.MAG_ROOT
  || [join(HOME, "IDEAVERSE", "Magazine"),
      join(process.env.QUIRE_WORKSPACE || join(HOME, "Quire"), "Magazine"),
      join(HOME, "InkDesk", "Magazine")].find(existsSync);

// The same workspace resolution studio.mjs uses.
const WORKSPACE = process.env.QUIRE_WORKSPACE
  || [join(HOME, "Quire"), join(HOME, "InkDesk")].find(existsSync)
  || join(HOME, "Quire");

if (!MAG_ROOT || !existsSync(join(MAG_ROOT, "issues"))) {
  console.log("no old magazine store found — nothing to migrate");
  process.exit(0);
}

const from = join(MAG_ROOT, "issues");
const to = join(WORKSPACE, "Magazine", "issues");
console.log(`from: ${from}`);
console.log(`to:   ${to}`);

let migrated = 0;
let skipped = 0;

for (const id of readdirSync(from)) {
  const oldFile = join(from, id, "issue.json");
  if (!existsSync(oldFile)) continue;

  const destDir = join(to, id);
  const destFile = join(destDir, "publication.json");
  if (existsSync(destFile) && !force) {
    console.log(`  skip ${id} — already migrated (use --force to replace)`);
    skipped++;
    continue;
  }

  let issue;
  try {
    issue = JSON.parse(readFileSync(oldFile, "utf-8"));
  } catch (error) {
    console.log(`  skip ${id} — unreadable: ${error.message}`);
    skipped++;
    continue;
  }

  // Copy the whole issue directory: pages/, art/ and build/ are referenced by
  // the issue and are the expensive part to lose.
  if (existsSync(destDir) && force) rmSync(destDir, { recursive: true, force: true });
  mkdirSync(destDir, { recursive: true });
  cpSync(join(from, id), destDir, { recursive: true });
  rmSync(join(destDir, "issue.json"), { force: true });

  // The one schema change: the runner has to know which definition governs
  // this issue, because the law it is checked against comes from there.
  writeFileSync(destFile, JSON.stringify({ ...issue, type: "magazine" }, null, 2), "utf-8");

  const written = (issue.pages ?? []).filter((p) => p.body !== null && p.body !== undefined).length;
  const art = (issue.pages ?? []).filter((p) => p.image).length;
  console.log(`  ok   ${id} — ${issue.pages?.length ?? 0}pp, ${written} written, ${art} with art`
    + `${issue.approved ? ", approved" : ""}${issue.build?.pdf ? ", has PDF" : ""}`);
  migrated++;
}

console.log(`\nmigrated ${migrated}, skipped ${skipped}. The originals are untouched at:\n  ${from}`);
