/**
 * Assert the three stages are in an order that makes sense.
 *
 * dev below prod is not a cosmetic oddity: the dev build shares the release
 * updater feed, so a dev that is older than prod tries to "update" itself into
 * prod on every single launch and can never succeed. That state was live for a
 * full release cycle and nothing anywhere noticed. This notices.
 */
import { join } from "node:path";
import { BACKUP_DIR, DEV_INSTALL, PROD_INSTALL, versionOf } from "./stages.mjs";

/** -1, 0, 1. Missing or unparseable parts sort as 0, so "0.1" < "0.1.1". */
function compare(a, b) {
  const pa = String(a).split("."), pb = String(b).split(".");
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = Number(pa[i] ?? 0) || 0, y = Number(pb[i] ?? 0) || 0;
    if (x !== y) return x < y ? -1 : 1;
  }
  return 0;
}

const stages = [
  ["dev", DEV_INSTALL], ["backup", BACKUP_DIR], ["prod", PROD_INSTALL],
].map(([name, dir]) => ({ name, dir, version: versionOf(join(dir, "quire.exe")) }));

for (const s of stages) console.log(`${s.name.padEnd(7)} ${s.version ?? "(not installed)"}  ${s.dir}`);

const dev = stages.find((s) => s.name === "dev")?.version;
const prod = stages.find((s) => s.name === "prod")?.version;
if (dev && prod && compare(dev, prod) < 0) {
  console.error(`\ndev ${dev} is BELOW prod ${prod}.`);
  console.error("Bump the version on dev before merging, not on master after.");
  process.exit(1);
}
console.log("\nok: dev is not behind prod");
