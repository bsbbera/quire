// Quire shell frontend. Starts the services once via Rust, then hands the
// window over to Studio. Model/provider settings live in the drawer.
const invoke = window.__TAURI__?.core?.invoke;

const $ = (s) => document.querySelector(s);
const state = { shim: "http://127.0.0.1:8787", studio: "", models: [], cli: null, model: null };

const savedTheme = localStorage.getItem("quire-theme");
if (savedTheme) document.documentElement.dataset.theme = savedTheme;
$("#theme").onclick = () => {
  const cur = document.documentElement.dataset.theme
    || (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
  const next = cur === "dark" ? "light" : "dark";
  document.documentElement.dataset.theme = next;
  localStorage.setItem("quire-theme", next);
};

let toastTimer;
function toast(msg) {
  const t = $("#toast");
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove("show"), 2400);
}

function openDrawer(open) {
  $("#drawer").hidden = !open;
  $("#scrim").hidden = !open;
}
$("#openSettings").onclick = () => openDrawer(true);
$("#closeSettings").onclick = () => openDrawer(false);
$("#scrim").onclick = () => openDrawer(false);
addEventListener("keydown", (e) => { if (e.key === "Escape") openDrawer(false); });

function renderProviders(agents) {
  const box = $("#providers");
  box.innerHTML = "";
  if (!agents.length) {
    box.innerHTML = '<p class="empty">No agent CLIs found on PATH.</p>';
    return;
  }
  for (const a of agents) {
    const card = document.createElement("button");
    card.className = "card";
    card.type = "button";
    card.setAttribute("aria-pressed", String(a.id === state.cli));
    card.innerHTML = `
      <div class="card-top">
        <img class="logo" src="${state.shim}/assets/${a.id}" alt=""
             onerror="this.style.visibility='hidden'">
        <span class="card-name">${a.id}</span>
        <span class="pill on" style="margin-left:auto">${a.models}</span>
      </div>
      <div class="meta" title="${a.version}">${a.version}</div>`;
    card.onclick = () => {
      state.cli = a.id;
      renderProviders(agents);
      renderModels();
    };
    box.appendChild(card);
  }
}

function renderModels() {
  const sel = $("#model");
  const q = $("#search").value.trim().toLowerCase();
  const mine = state.models.filter((m) => m.owned_by === state.cli);
  const shown = q ? mine.filter((m) => m.id.toLowerCase().includes(q)) : mine;
  sel.innerHTML = "";
  for (const m of shown) {
    const o = document.createElement("option");
    o.value = m.id;
    o.textContent = m.id.split("/").slice(1).join("/");
    sel.appendChild(o);
  }
  if (state.model && shown.some((m) => m.id === state.model)) sel.value = state.model;
  $("#count").textContent =
    `${shown.length} of ${mine.length} for ${state.cli ?? "—"} · ${state.models.length} total`;
  sel.disabled = shown.length === 0;
}

function showModel(model) {
  $("#activeModel").textContent = model || "—";
  $("#fabModel").textContent = model ? model.split("/").slice(1).join("/") : "no model";
}

async function save(model) {
  try {
    const r = await fetch(`${state.shim}/config`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model }),
    });
    const j = await r.json();
    if (!j.ok) return toast("save failed: " + (j.error || "unknown"));
    state.model = model;
    showModel(model);
    toast("saved — " + model);
  } catch (e) {
    toast("save failed: " + e.message);
  }
}

$("#search").oninput = renderModels;
$("#model").onchange = (e) => save(e.target.value);
$("#refresh").onclick = () => loadShim(true).catch((e) => toast(e.message));

async function loadShim(force) {
  const [status, models, cfg] = await Promise.all([
    fetch(`${state.shim}/status${force ? "?fresh=1" : ""}`).then((r) => r.json()),
    fetch(`${state.shim}/v1/models`).then((r) => r.json()),
    fetch(`${state.shim}/config`).then((r) => r.json()),
  ]);
  state.models = models.data;
  state.model = cfg.model || null;
  state.cli = (cfg.model && cfg.model.split("/")[0]) || status.agents[0]?.id || null;
  showModel(state.model);
  $("#foot").textContent = `${appVersion ? "Quire " + appVersion + " · " : ""}shim :${status.port} · ${status.agents.length} CLIs · ${status.total} models`;
  $("#langFoot").textContent = "lang " + status.lang;
  renderProviders(status.agents);
  renderModels();
}


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

// getVersion is core API, not a plugin, so withGlobalTauri really does expose
// it - unlike the updater, which is why that one goes through invoke.
async function showVersion() {
  try {
    appVersion = await window.__TAURI__.app.getVersion();
  } catch { return; }
  const v = "Quire " + appVersion;
  const line = $("#verLine"); if (line) line.textContent = v;
  const foot = $("#foot"); if (foot && foot.textContent === "—") foot.textContent = v;
  const sub = $("#sub"); if (sub) sub.dataset.version = v;
}
let pendingUpdate = null;

/** Say when the last check happened, so a check that finds nothing still reads
 *  as a check that ran. */
function stamp() {
  const line = $("#verLine");
  if (!line) return;
  const t = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  line.textContent = `Quire ${appVersion || ""} · checked ${t}`.replace("  ", " ");
}

async function checkUpdate({ silent } = {}) {
  const row = $("#updateRow"), msg = $("#updateMsg"), btn = $("#updateBtn");
  if (!row) return null;
  if (!invoke) { msg.textContent = "Updates unavailable outside the app"; return null; }
  row.classList.add("busy");
  msg.textContent = "Checking for updates…";
  try {
    const meta = await invoke("plugin:updater|check", {});
    row.classList.remove("busy");
    localStorage.setItem(LAST_CHECK, String(Date.now()));
    stamp();
    // `check` returns the update, or null when there is none. It has no
    // `available` flag - that belongs to the JS binding's Update class, which
    // this app does not use. Testing for it discarded every update that was
    // actually found and reported "up to date" instead, so pressing Check
    // rewrote the same sentence and looked like a dead button.
    if (!meta) {
      msg.textContent = appVersion ? `Quire ${appVersion} is up to date` : "Quire is up to date";
      btn.hidden = true;
      return null;
    }
    pendingUpdate = meta;              // meta.rid is the handle install needs
    msg.textContent = `Version ${meta.version} available`;
    btn.hidden = false;
    // Automatic means the launch check installs it. It used to be gated on
    // `!silent`, which is only the manual check - so the one path that made
    // the setting worth having was the path it skipped.
    if (localStorage.getItem(AUTO_KEY) === "1") installUpdate();
    return meta;
  } catch (e) {
    row.classList.remove("busy");
    msg.textContent = silent ? "Update check unavailable" : "Update check failed: " + e;
    btn.hidden = true;
    return null;
  }
}

async function installUpdate() {
  if (!pendingUpdate) return;
  const msg = $("#updateMsg"), btn = $("#updateBtn");
  btn.disabled = true;
  try {
    // Progress arrives on a Channel when the core API exposes one; without it
    // the download still runs, it just cannot report a percentage.
    // The Rust command takes the channel by value, not as an Option, so there
    // is no version of this call without one. Failing here is better than
    // sending undefined and getting an opaque deserialization error.
    const Channel = window.__TAURI__?.core?.Channel;
    if (!Channel) throw new Error("no Channel in the Tauri core API");
    let onEvent;
    {
      let got = 0, total = 0;
      onEvent = new Channel();
      onEvent.onmessage = (ev) => {
        if (ev.event === "Started") total = ev.data?.contentLength || 0;
        if (ev.event === "Progress") {
          got += ev.data?.chunkLength || 0;
          msg.textContent = total
            ? `Downloading ${Math.round((got / total) * 100)}%`
            : "Downloading…";
        }
        if (ev.event === "Finished") msg.textContent = "Installing…";
      };
    }
    await invoke("plugin:updater|download_and_install", { rid: pendingUpdate.rid, onEvent });
    await invoke("plugin:process|restart");
  } catch (e) {
    msg.textContent = "Update failed: " + e;
    btn.disabled = false;
  }
}

function wireUpdates() {
  const auto = $("#autoUpdate");
  if (auto) {
    auto.checked = localStorage.getItem(AUTO_KEY) === "1";
    auto.addEventListener("change", () => {
      localStorage.setItem(AUTO_KEY, auto.checked ? "1" : "0");
      if (auto.checked && pendingUpdate) installUpdate();
    });
  }
  $("#updateBtn")?.addEventListener("click", installUpdate);
  // A launch-only check is not syncing: the app can sit open for days. Manual
  // button for "why have I not got it yet", plus a slow poll while it runs.
  $("#checkBtn")?.addEventListener("click", () => checkUpdate({ silent: false }));
  // Integrations render inside Studio, so the drawer asks the iframe to show
  // them rather than duplicating the view in the shell.
  $("#openPlugs")?.addEventListener("click", () => {
    $("#frame")?.contentWindow?.postMessage({ quire: "open-view", view: "plugs" }, "*");
    openDrawer(false);
  });
  // Studio's sidebar "Updates" entry: it has no Tauri API of its own, so it
  // asks the shell to open the drawer and run the check.
  addEventListener("message", (e) => {
    if (e.data?.quire !== "open-updates") return;
    openDrawer(true);
    $("#updateRow")?.scrollIntoView({ block: "nearest" });
    checkUpdate({ silent: false });
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
