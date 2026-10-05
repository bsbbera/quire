// Self-check for the move from InkOS names to Quire's.
//
//   node --test cli-shim/migrate-names.test.mjs
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { migrateNames } from "./migrate-names.mjs";

function workspace() {
  const base = mkdtempSync(join(tmpdir(), "quire-names-"));
  const root = join(base, "ws");
  const home = join(base, "home");
  mkdirSync(join(root, ".inkos", "materials"), { recursive: true });
  mkdirSync(join(root, ".inkos", "sessions"), { recursive: true });
  mkdirSync(join(root, ".quire"), { recursive: true });
  mkdirSync(join(home, ".inkos"), { recursive: true });
  writeFileSync(join(root, ".inkos", "sessions", "a.jsonl"), "{}\n");
  writeFileSync(join(root, ".inkos", "secrets.json"), "{}");
  writeFileSync(join(root, ".quire", "findings.json"), "[]");
  writeFileSync(join(root, ".inkos", "materials", "p.md"), "# Pinhole");
  writeFileSync(join(root, ".inkos", "materials", "p.json"), JSON.stringify({
    markdownPath: ".inkos/materials/p.md", manifestPath: ".inkos/materials/p.json",
  }));
  writeFileSync(join(root, "inkos.json"), "{\"llm\":{}}");
  writeFileSync(join(home, ".inkos", ".env"), "INKOS_LLM_MODEL=x\n# INKOS_LLM_API_KEY=secret\nOTHER=1\n");
  return { base, root, home };
}

test("moves state, research and config to the Quire names", () => {
  const { base, root, home } = workspace();
  try {
    migrateNames(root, home);
    assert.equal(existsSync(join(root, ".inkos")), false);
    assert.ok(existsSync(join(root, ".quire", "sessions", "a.jsonl")));
    assert.ok(existsSync(join(root, ".quire", "secrets.json")));
    assert.ok(existsSync(join(root, ".quire", "findings.json")));
    assert.equal(readFileSync(join(root, "research", "p.md"), "utf-8"), "# Pinhole");
    const manifest = JSON.parse(readFileSync(join(root, "research", "p.json"), "utf-8"));
    assert.equal(manifest.markdownPath, "research/p.md");
    assert.equal(manifest.manifestPath, "research/p.json");
    assert.ok(existsSync(join(root, "quire.json")));
    assert.equal(existsSync(join(root, "inkos.json")), false);
  } finally { rmSync(base, { recursive: true, force: true }); }
});

test("copies the home folder, leaves the old one for older builds, renames keys", () => {
  const { base, root, home } = workspace();
  try {
    migrateNames(root, home);
    assert.ok(existsSync(join(home, ".inkos", ".env")));
    assert.equal(
      readFileSync(join(home, ".quire", ".env"), "utf-8"),
      "QUIRE_LLM_MODEL=x\n# QUIRE_LLM_API_KEY=secret\nOTHER=1\n",
    );
  } finally { rmSync(base, { recursive: true, force: true }); }
});

test("never overwrites, and runs again without harm", () => {
  const { base, root, home } = workspace();
  try {
    writeFileSync(join(root, ".quire", "secrets.json"), "{\"new\":true}");
    const first = migrateNames(root, home);
    assert.equal(readFileSync(join(root, ".quire", "secrets.json"), "utf-8"), "{\"new\":true}");
    assert.ok(existsSync(join(root, ".inkos", "secrets.json")));
    assert.ok(first.some((line) => line.includes("kept .inkos/secrets.json")));
    assert.doesNotThrow(() => migrateNames(root, home));
  } finally { rmSync(base, { recursive: true, force: true }); }
});
