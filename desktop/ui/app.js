// Quire shell frontend. Starts the services once via Rust, then hands the
// window over to Studio. Model/provider settings live in the drawer.
const invoke = window.__TAURI__?.core?.invoke;

const $ = (s) => document.querySelector(s);
const state = { shim: "http://127.0.0.1:8787", studio: "", models: [], cli: null, model: null };

/*
 * Theme follows the workbench.
 *
 * The shell used to own a second preference and a second toggle, in its own
 * storage key, which is how the settings drawer could sit dark over a light
 * workbench. Studio is the surface a person actually looks at, so it owns the
 * choice and this listens; the toggle here is gone rather than duplicated.
 *
 * The stored value is still read on boot: the cover paints before Studio has
 * loaded and has to be the right colour immediately, and the message arrives
 * only once the workbench mounts.
 */
const savedTheme = localStorage.getItem("quire-theme");
if (savedTheme === "dark" || savedTheme === "light") {
  document.documentElement.dataset.theme = savedTheme;
}

addEventListener("message", (e) => {
  // Only the workbench in our own iframe may set this. Anything else on the
  // page - an embedded preview, an extension - is not the workbench.
  if (e.source !== $("#frame")?.contentWindow) return;
  const theme = e.data?.type === "quire:theme" ? e.data.theme : null;
  if (theme !== "dark" && theme !== "light") return;
  document.documentElement.dataset.theme = theme;
  localStorage.setItem("quire-theme", theme);
});

let toastTimer;
function toast(msg) {
  const t = $("#toast");
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove("show"), 2400);
}

async function loadShim(force) {
  const [status, models, cfg] = await Promise.all([
    fetch(`${state.shim}/status${force ? "?fresh=1" : ""}`).then((r) => r.json()),
    fetch(`${state.shim}/v1/models`).then((r) => r.json()),
    fetch(`${state.shim}/config`).then((r) => r.json()),
  ]);
  state.models = models.data;
  state.model = cfg.model || null;
  state.cli = (cfg.model && cfg.model.split("/")[0]) || status.agents[0]?.id || null;
}



/* ------------------------------------------------------------------ restart
 * The workspace folder is chosen in the workbench now, but only the shell has
 * Tauri: a webview in an iframe cannot restart the process it runs in. So the
 * workbench asks, and this answers. Same bridge the Updates entry already uses.
 */
addEventListener("message", (e) => {
  if (e.source !== $("#frame")?.contentWindow) return;
  if (e.data?.quire !== "restart") return;
  toast("Restarting…");
  setTimeout(() => invoke("plugin:process|restart"), 600);
});

/** One boot step: waiting, running, done or failed, plus an optional note. */
function step(el, state, note) {
  if (!el) return;
  el.classList.remove("run", "done", "fail");
  if (state) el.classList.add(state);
  const n = el.querySelector(".step-note");
  if (n) n.textContent = note || "";
}

/**
 * Boot progress. Honest by construction: the percentage is the share of steps
 * actually finished, never a timer pretending to be progress. A bar that
 * crawls to 90% and waits is a lie the user can see through.
 */
function progress(done, total) {
  const p = Math.round((done / total) * 100);
  const fill = $("#barFill");
  if (fill) fill.style.transform = `scaleX(${(done / total).toFixed(3)})`;
  const pct = $("#pct");
  if (pct) pct.textContent = p + "%";
}

/* ------------------------------------------------------------------ updates
 * The updater and process plugins are driven through invoke, NOT through
 * window.__TAURI__.updater. withGlobalTauri exposes the core API only; plugin
 * bindings ship as npm packages and would need a bundler. Reaching for the
 * global left `api?.check` undefined, which hid the whole row - the update
 * option was not missing from the drawer, it was deleting itself on boot.
 *
 * Checking is automatic; INSTALLING is not, unless the user opts in. Quire owns
 * two child processes and a relaunch mid-write is how a half-written chapter
 * happens, so an update is applied when the user says so, or at the next launch
 * when "Automatic" is ticked.
 */
const AUTO_KEY = "quire-auto-update";
const LAST_CHECK = "quire-last-check";
let appVersion = "";
/**
 * The dev build shares this shell, this updater key and this endpoint with the
 * release build, and carries whatever version the branch happens to be on. So
 * every launch of Quire-Dev found the released Quire newer than itself, ran the
 * release installer, and found it newer again next launch: a forced install
 * every single time, that could never make the dev build any newer. The dev
 * copy is deployed by `build-dev.mjs`, not by the updater.
 */
let isDevBuild = false;

// getVersion is core API, not a plugin, so withGlobalTauri really does expose
// it - unlike the updater, which is why that one goes through invoke.
async function showVersion() {
  try {
    appVersion = await window.__TAURI__.app.getVersion();
    isDevBuild = (await window.__TAURI__.app.getName()) === "Quire-Dev";
  } catch { return; }
  const sub = $("#sub"); if (sub) sub.dataset.version = "Quire " + appVersion;
  publishUpdate({});
}
let pendingUpdate = null;
/**
 * What the workbench renders. The shell has no panel any more, so this is the
 * whole of the updater's UI contract: a message with everything a card needs,
 * sent whenever it changes and on request.
 */
let updateState = { status: "idle", message: "", version: "", available: false, dev: false, auto: false, checkedAt: 0 };

function publishUpdate(patch) {
  updateState = {
    ...updateState,
    ...patch,
    version: appVersion,
    dev: isDevBuild,
    auto: localStorage.getItem(AUTO_KEY) === "1",
  };
  $("#frame")?.contentWindow?.postMessage({ quire: "update:state", ...updateState }, "*");
}

async function checkUpdate({ silent } = {}) {
  if (!invoke) { publishUpdate({ status: "unavailable", message: "Updates unavailable outside the app" }); return null; }
  if (isDevBuild) {
    // The dev build shares this updater key with the release, so every launch
    // found the release "newer" and reinstalled it, forever. It is deployed by
    // build-dev.mjs, not by the updater.
    publishUpdate({ status: "dev", message: "Development build — updates come from a rebuild", available: false });
    return null;
  }
  publishUpdate({ status: "checking", message: "Checking for updates…" });
  try {
    const meta = await invoke("plugin:updater|check", {});
    localStorage.setItem(LAST_CHECK, String(Date.now()));
    // `check` returns the update, or null when there is none. It has no
    // `available` flag — that belongs to the JS binding's Update class, which
    // this app does not use. Testing for it discarded every update actually
    // found and reported "up to date" instead.
    if (!meta) {
      publishUpdate({
        status: "current", available: false, checkedAt: Date.now(),
        message: appVersion ? `Quire ${appVersion} is up to date` : "Quire is up to date",
      });
      return null;
    }
    pendingUpdate = meta;              // meta.rid is the handle install needs
    publishUpdate({
      status: "available", available: true, checkedAt: Date.now(),
      message: `Version ${meta.version} available`,
    });
    // Automatic means the launch check installs it. It used to be gated on
    // `!silent`, which is only the manual check — the one path that made the
    // setting worth having was the path it skipped.
    if (localStorage.getItem(AUTO_KEY) === "1") void installUpdate();
    return meta;
  } catch (e) {
    publishUpdate({
      status: "error", available: false,
      message: silent ? "Update check unavailable" : "Update check failed: " + e,
    });
    return null;
  }
}

async function installUpdate() {
  if (!pendingUpdate) return;
  publishUpdate({ status: "installing", message: "Starting download…" });
  try {
    // The Rust command takes the channel by value, not as an Option, so there
    // is no version of this call without one. Failing here is better than
    // sending undefined and getting an opaque deserialization error.
    const Channel = window.__TAURI__?.core?.Channel;
    if (!Channel) throw new Error("no Channel in the Tauri core API");
    let got = 0, total = 0;
    const onEvent = new Channel();
    onEvent.onmessage = (ev) => {
      if (ev.event === "Started") total = ev.data?.contentLength || 0;
      if (ev.event === "Progress") {
        got += ev.data?.chunkLength || 0;
        publishUpdate({
          status: "installing",
          message: total ? `Downloading ${Math.round((got / total) * 100)}%` : "Downloading…",
        });
      }
      if (ev.event === "Finished") publishUpdate({ status: "installing", message: "Installing…" });
    };
    await invoke("plugin:updater|download_and_install", { rid: pendingUpdate.rid, onEvent });
    await invoke("plugin:process|restart");
  } catch (e) {
    publishUpdate({ status: "error", message: "Update failed: " + e });
  }
}

function wireUpdates() {
  // The workbench owns every visible control now. Only these two calls need
  // Tauri, so the shell keeps them and answers when asked.
  addEventListener("message", (e) => {
    if (e.source !== $("#frame")?.contentWindow) return;
    const q = e.data?.quire;
    if (q === "update:check") void checkUpdate({ silent: false });
    else if (q === "update:install") void installUpdate();
    else if (q === "update:auto") {
      localStorage.setItem(AUTO_KEY, e.data.value ? "1" : "0");
      publishUpdate();
    } else if (q === "update:state") publishUpdate();
  });
  setInterval(() => checkUpdate({ silent: true }), 6 * 60 * 60 * 1000);
}

// Any failure here used to leave the window sitting on "starting…" forever, so
// surface it on the boot cover instead of only in the devtools console.
function fatal(msg) {
  $("#cover").hidden = false;
  $("#sub").textContent = "failed to start";
  $("#stepShim").classList.add("fail");
  $("#stepStudio").classList.add("fail");
  $("#notes").textContent = msg;
}

window.addEventListener("error", (e) => fatal(String(e.message || e.error)));
window.addEventListener("unhandledrejection", (e) => fatal(String(e.reason)));

(async () => {
  if (!invoke) return fatal("Tauri API unavailable — the app shell did not inject window.__TAURI__.");
  await showVersion();

  // `boot` spawns and returns at once now, so the cover can report progress
  // instead of freezing until both ports answer.
  const boot = await invoke("boot");
  state.shim = boot.shim_url;
  state.studio = boot.studio_url;
  if (boot.notes.length) $("#notes").textContent = boot.notes.join("\n");

  const t0 = Date.now();
  const STEPS = 3;
  const tick = setInterval(() => {
    const sec = Math.round((Date.now() - t0) / 1000);
    $("#elapsed").textContent = sec > 2 ? `  ·  ${sec}s` : "";
    // A cold first launch is dominated by the workbench building its index.
    // Saying so beats leaving the user to wonder whether it has hung.
    if (sec > 20) $("#firstRun").hidden = false;
  }, 500);

  step($("#stepShim"), "run", "starting");
  step($("#stepStudio"), "", "waiting");
  step($("#stepModels"), "", "waiting");
  progress(0, STEPS);

  // The workbench is the slow half: it spawns node and builds its own server,
  // tens of seconds cold. 180s before giving up, matching the timeouts the
  // blocking version used rather than quietly shortening them.
  let ready = boot, done = 0;
  for (let i = 0; i < 360 && !(ready.shim_ready && ready.studio_ready); i++) {
    if (ready.shim_ready && !done) {
      done = 1;
      step($("#stepShim"), "done", "ready");
      step($("#stepStudio"), "run", "building");
      progress(1, STEPS);
    }
    await new Promise((r) => setTimeout(r, 500));
    ready = await invoke("status");
  }
  clearInterval(tick);
  step($("#stepShim"), ready.shim_ready ? "done" : "fail", ready.shim_ready ? "ready" : "not running");
  step($("#stepStudio"), ready.studio_ready ? "done" : "fail", ready.studio_ready ? "ready" : "did not start");
  progress(ready.studio_ready ? 2 : 1, STEPS);

  if (!ready.studio_ready) {
    $("#sub").textContent = "The workbench did not start";
    $("#bar").hidden = true;
    $("#firstRun").hidden = true;
    return;
  }
  $("#sub").textContent = "Ready";
  step($("#stepModels"), "run", "scanning");

  // Studio takes the window; the cover only lifts once it has actually painted.
  const frame = $("#frame");
  frame.hidden = false;
  // Studio has no Tauri API of its own, so the version rides in on the hash
  // and the patch renders it under the sidebar wordmark.
  // The version rides in twice on purpose. The hash is what the patch reads to
  // print the version in the sidebar; the query is a cache buster for
  // index.html itself, which Studio serves with no cache headers - a hash
  // alone never reaches the network, so an updated app kept booting the
  // previous release's page and looked unchanged.
  frame.src = state.studio + (appVersion
    ? `/?b=${encodeURIComponent(appVersion)}#qv=${encodeURIComponent(appVersion)}`
    : "");
  const lift = () => { $("#cover").hidden = true; };
  frame.addEventListener("load", lift, { once: true });
  // The port already answered, so never let a missing load event strand the
  // window on the boot cover.
  setTimeout(lift, 8000);

  wireUpdates();
  // Silent on launch: a failed check must never block getting to work.
  checkUpdate({ silent: true });

  if (ready.shim_ready) {
    $("#openSettings").hidden = false;
    try {
      await loadShim(false);
      step($("#stepModels"), "done", `${state.models.length} models`);
      progress(3, STEPS);
    } catch (e) {
      step($("#stepModels"), "fail", "unreachable");
      toast("shim unreachable: " + e.message);
    }
  }
})().catch((e) => fatal(String(e?.message || e)));
