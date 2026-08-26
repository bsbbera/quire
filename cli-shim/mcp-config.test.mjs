#!/usr/bin/env node
// The two things that must hold about Quire's own MCP config.
//
//   node cli-shim/mcp-config.test.mjs
//
// 1. It is never committed. The file holds live API keys after the import.
// 2. The import happens once. If discovery kept running, another app's config
//    would still be deciding what tools Quire has.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repo = dirname(here);
let failures = 0;
const check = (name, fn) => {
  try { fn(); console.log(`  ok   ${name}`); }
  catch (e) { failures++; console.log(`  FAIL ${name}: ${e.message}`); }
};

check("mcp.json is not tracked by git", () => {
  const tracked = execFileSync("git", ["ls-files", "--", "*.inkos/mcp.json", ".inkos/"], {
    cwd: repo, encoding: "utf8",
  }).trim();
  assert.equal(tracked, "", `these are committed and hold API keys:\n${tracked}`);
});

check("mcp.json is ignored, so it cannot be added by accident", () => {
  const out = execFileSync("git", ["check-ignore", "-q", ".inkos/mcp.json"], {
    cwd: repo, encoding: "utf8",
  });
  assert.equal(out, "");   // exit 0 means ignored; a non-zero exit throws
});

// A child process with its own home, so the real ~/.inkos is never touched.
const run = (home, script) => execFileSync(process.execPath, ["--input-type=module", "-e", script], {
  encoding: "utf8",
  env: { ...process.env, HOME: home, USERPROFILE: home },
  cwd: here,
});

check("discovery is copied in once, then the file is the only source", () => {
  const home = mkdtempSync(join(tmpdir(), "quire-mcp-"));
  try {
    // One discoverable server, in the plainest place discovery looks.
    const desktop = join(home, "AppData", "Roaming", "Claude");
    mkdirSync(desktop, { recursive: true });
    writeFileSync(join(desktop, "claude_desktop_config.json"), JSON.stringify({
      mcpServers: { borrowed: { command: "node", args: ["x.mjs"], env: { API_KEY: "sk-test" } } },
    }));

    const url = JSON.stringify(new URL("./mcp.mjs", import.meta.url).href);
    const first = JSON.parse(run(home,
      `const m = await import(${url}); console.log(JSON.stringify(m.servers()));`));
    assert.ok(first.borrowed, "the configured server was not picked up");
    assert.equal(first.borrowed.imported, true, "it was not marked as imported");

    const written = JSON.parse(readFileSync(join(home, ".inkos", "mcp.json"), "utf8"));
    assert.equal(written.mcpServers.borrowed.env.API_KEY, "sk-test",
      "the credential was not copied, so the server would need reconnecting");

    // Now take the source away. An app Quire no longer reads.
    rmSync(join(desktop, "claude_desktop_config.json"));
    const second = JSON.parse(run(home,
      `const m = await import(${url}); console.log(JSON.stringify(m.servers()));`));
    assert.ok(second.borrowed, "the server vanished when its original config did");
    assert.ok(second.quire?.bundled, "the bundled server should always be present");
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

console.log(failures ? `\n${failures} failed` : "\nall passed");
process.exit(failures ? 1 : 0);
