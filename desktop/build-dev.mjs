// Builds the side-by-side development copy: "Quire Dev", its own identifier,
// its own install directory, its own ports.
//
// The ports have to be set here rather than in tauri.dev.conf.json because
// main.rs bakes them in at compile time (option_env!). They must stay in sync
// with the CSP in tauri.dev.conf.json, which names the same two ports.
import { execFileSync } from "node:child_process";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const env = { ...process.env, QUIRE_SHIM_PORT: "8788", QUIRE_STUDIO_PORT: "4568" };

for (const step of [
  ["node", ["vendor-inkos.mjs"]],
  ["node", ["clean-resources.mjs"]],
  ["npx", ["tauri", "build", "--config", "src-tauri/tauri.dev.conf.json"]],
]) {
  execFileSync(step[0], step[1], { cwd: HERE, stdio: "inherit", env, shell: process.platform === "win32" });
}
