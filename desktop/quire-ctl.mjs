/**
 * Drive a running Quire over its HTTP API.
 *
 * Testing this app has meant hand-written curl against a port number recalled
 * from memory, and getting the build wrong means "verifying" a fix against the
 * other install entirely — which has happened. Name the stage, not the port.
 *
 *   node quire-ctl.mjs dev  /api/v1/build
 *   node quire-ctl.mjs prod /api/v1/audit/projects
 *   node quire-ctl.mjs dev  /api/v1/audit/run '{"path":"..."}'
 *
 * A path starting /api goes to Studio; anything else goes to the model shim.
 *
 * Under Git Bash, prefix with MSYS_NO_PATHCONV=1 or the leading slash is
 * rewritten to a Windows path before this script ever sees it.
 */
const PORTS = {
  dev: { studio: 4568, shim: 8788 },
  prod: { studio: 4567, shim: 8787 },
};

const [stage, path, body] = process.argv.slice(2);
if (!PORTS[stage] || !path) {
  console.error("usage: node quire-ctl.mjs <dev|prod> <path> [json-body]");
  process.exit(2);
}

const port = path.startsWith("/api") ? PORTS[stage].studio : PORTS[stage].shim;
const url = `http://127.0.0.1:${port}${path}`;

const res = await fetch(url, body
  ? { method: "POST", headers: { "content-type": "application/json" }, body }
  : {}).catch((err) => {
    // A refused connection means that build is not running — worth saying
    // plainly, since the alternative reading is "the endpoint is broken".
    console.error(`${stage} is not answering on :${port} — is it running? (${err.message})`);
    process.exit(1);
  });

const text = await res.text();
console.error(`${res.status} ${res.statusText}  ${url}`);
try { console.log(JSON.stringify(JSON.parse(text), null, 2)); }
catch { console.log(text); }
if (!res.ok) process.exit(1);
