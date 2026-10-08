#!/usr/bin/env node
// The two things that must hold about Quire's own MCP config.
//
//   node cli-shim/mcp-config.test.mjs
//
// 1. It is never committed. The file holds live API keys after the import.
// 2. Detection only adds. A server another app gains later is picked up, but an
//    entry already in Quire's file is never rewritten by the source app, and one
//    the user removed never comes back.
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
  const tracked = execFileSync("git", ["ls-files", "--", "*.quire/mcp.json", ".quire/"], {
    cwd: repo, encoding: "utf8",
  }).trim();
  assert.equal(tracked, "", `these are committed and hold API keys:\n${tracked}`);
});

check("mcp.json is ignored, so it cannot be added by accident", () => {
  const out = execFileSync("git", ["check-ignore", "-q", ".quire/mcp.json"], {
    cwd: repo, encoding: "utf8",
  });
  assert.equal(out, "");   // exit 0 means ignored; a non-zero exit throws
});

// A child process with its own home, so the real ~/.quire is never touched.
const run = (home, script) => execFileSync(process.execPath, ["--input-type=module", "-e", script], {
  encoding: "utf8",
  env: { ...process.env, HOME: home, USERPROFILE: home },
  cwd: here,
});

check("detection adds new servers, never rewrites or revives one, and pasted ones are added", () => {
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

    const written = JSON.parse(readFileSync(join(home, ".quire", "mcp.json"), "utf8"));
    assert.equal(written.mcpServers.borrowed.env.API_KEY, "sk-test",
      "the credential was not copied, so the server would need reconnecting");

    // The source app changes the server and gains a new one; Cursor gets one too
    // (a Store-style Claude path is not needed: any listed app is enough here).
    writeFileSync(join(desktop, "claude_desktop_config.json"), JSON.stringify({
      mcpServers: { borrowed: { command: "changed" }, later: { command: "node", args: ["y.mjs"] } },
    }));
    mkdirSync(join(home, ".cursor"), { recursive: true });
    writeFileSync(join(home, ".cursor", "mcp.json"), JSON.stringify({ mcpServers: { cursed: { command: "uvx", args: ["c"] }, remote: { url: "https://x" } } }));
    const second = JSON.parse(run(home,
      `const m = await import(${url}); m.rescan(); console.log(JSON.stringify(m.servers()));`));
    assert.equal(second.borrowed.command, "node", "the source app rewrote an entry Quire already had");
    assert.ok(second.later && second.cursed, "a server added later in another app was not picked up");
    assert.ok(!second.remote, "a url-only server was listed, and nothing here can start it");
    assert.ok(second.quire?.bundled, "the bundled server should always be present");

    // Removed by the user: Rescan must not bring it back.
    const third = JSON.parse(run(home,
      `const m = await import(${url}); m.remove("later"); m.rescan(); console.log(JSON.stringify(m.servers()));`));
    assert.ok(!third.later, "a removed server came back on rescan");

    // Added by hand, from a pasted config block.
    const fourth = JSON.parse(run(home,
      `const m = await import(${url}); m.add('{"mcpServers":{"Hand Made":{"command":"npx","args":["-y","z"]}}}'); console.log(JSON.stringify(m.servers()));`));
    assert.equal(fourth["hand-made"]?.source, "user", "a pasted server was not added");
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

console.log(failures ? `\n${failures} failed` : "\nall passed");
process.exit(failures ? 1 : 0);
