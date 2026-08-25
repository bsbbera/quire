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
$("#openSettings").onclick = () => { openDrawer(true); loadComfy?.(); };
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
    const card = document.createElement("div");
    card.className = "card";
    card.innerHTML = `
      <div class="card-top">
        <img class="logo" src="${state.shim}/assets/${a.id}" alt=""
             onerror="this.style.visibility='hidden'">
        <span class="card-name">${a.id}</span>
        <span class="pill on" style="margin-left:auto">${a.models}</span>
      </div>
      <div class="meta" title="${a.version}">${a.version}</div>`;
    // Cards report what is installed; they no longer select anything.
    box.appendChild(card);
  }
}

// The shell used to carry its own model picker, reading and writing the shim
// while the workbench's picker read and wrote the project config. Two
// selectors, two sources of truth, and they disagreed on screen: the shell
// showed a model while chat refused to send for want of one. The workbench
// owns model selection now, and the shim reads that same config.

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
  $("#foot").textContent = `${appVersion ? "Quire " + appVersion + " · " : ""}shim :${status.port} · ${status.agents.length} CLIs · ${status.total} models`;
  $("#langFoot").textContent = "lang " + status.lang;
  renderProviders(status.agents);
}



/* ------------------------------------------------------------------- images
 * ComfyUI is the one dependency Quire installs itself, so its install, its
 * hardware tier and its workflows are settings of the machine rather than of a
 * book — which is why they live in the shell's drawer and not in the workbench.
 */
const gb = (n) => (n / 1e9).toFixed(1) + " GB";
let comfyPoll = null;

function setComfyProgress(install) {
  const bar = $("#comfyBar");
  const line = $("#comfyStep");
  if (!install || install.done) {
    bar.hidden = true;
    line.hidden = !install || !install.error;
    if (install?.error) line.textContent = "install failed: " + install.error;
    return;
  }
  bar.hidden = false;
  line.hidden = false;
  // Honest again: bytes fetched over bytes expected for the stage in flight.
  // Extraction reports no total, so it says so rather than freezing at a number.
  const frac = install.total ? install.got / install.total : 0;
  $("#comfyFill").style.transform = `scaleX(${frac.toFixed(3)})`;
  line.textContent = install.total
    ? `${install.step} · ${gb(install.got)} of ${gb(install.total)} · ${Math.round(frac * 100)}%`
    : `${install.step}…`;
}

async function renderWorkflows(status) {
  const sel = $("#workflow");
  let payload;
  try {
    payload = await fetch(`${state.shim}/comfy/workflows`).then((r) => r.json());
  } catch { return; }
  sel.innerHTML = "";
  for (const w of payload.workflows) {
    const o = document.createElement("option");
    o.value = w.id;
    o.textContent = w.label + (w.builtin ? " (built in)" : "");
    sel.appendChild(o);
  }
  if (payload.selected) sel.value = payload.selected;
  const current = payload.workflows.find((w) => w.id === sel.value);
  $("#workflowField").hidden = false;
  $("#workflowAdd").hidden = false;
  // The built-in is what every other failure falls back to, so it has no
  // delete button at all rather than one that reports a refusal.
  $("#workflowDelete").hidden = !current || current.builtin;
  const bad = payload.diagnostics?.length
    ? ` · ${payload.diagnostics.length} file(s) ignored: ${payload.diagnostics[0].problems[0]}`
    : "";
  $("#workflowNote").textContent = (current?.note || "") + bad;
  state.workflows = payload.workflows;
}

async function loadComfy() {
  let st;
  try {
    st = await fetch(`${state.shim}/comfy/status`).then((r) => r.json());
  } catch (e) {
    $("#comfyLine").textContent = "shim unreachable";
    return null;
  }
  state.comfy = st;
  const pill = $("#comfyPill");
  const installing = st.install && !st.install.done;

  pill.textContent = st.up ? "running" : st.installed ? "installed" : installing ? "installing" : "not installed";
  pill.classList.toggle("on", !!st.up);

  $("#comfyLine").textContent = st.installed
    ? "Images render on this machine. No API key, works offline."
    : "Not installed. About 11 GB of runtime and model weights.";

  const bench = st.benchmark
    ? `${st.device} · benchmarked ${(st.benchmark.ms / 1000).toFixed(1)}s for a 512px test`
    : `${st.device} · not benchmarked yet`;
  $("#comfyDetail").textContent = st.installed ? `${bench} · ${st.dir}` : "—";

  $("#comfyInstall").hidden = st.installed || installing;
  $("#comfyInstall").textContent = st.install?.error ? "Retry install" : "Install ComfyUI";
  // firstRun is false once the install exists or the user declined once.
  $("#comfySkip").hidden = st.installed || installing || !st.firstRun;
  $("#comfyStart").hidden = !st.installed || st.up;
  $("#comfyBench").hidden = !st.installed;
  setComfyProgress(st.install);
  if (st.installed) await renderWorkflows(st);

  // Poll only while something is moving, so an idle drawer costs nothing.
  if (installing && !comfyPoll) comfyPoll = setInterval(() => loadComfy(), 1000);
  if (!installing && comfyPoll) { clearInterval(comfyPoll); comfyPoll = null; }
  return st;
}

function wireComfy() {
  $("#comfyInstall").onclick = async () => {
    $("#comfyInstall").hidden = true;
    try {
      const r = await fetch(`${state.shim}/comfy/install`, {
        method: "POST", headers: { "content-type": "application/json" }, body: "{}",
      }).then((x) => x.json());
      if (!r.ok && r.error) toast(r.error);
      // A part-file from an interrupted run is resumed, not restarted, so
      // pressing this after a kill picks up where the download stopped.
      else toast(`downloading ${gb(r.plan.bytes)} to ${r.plan.dir}`);
    } catch (e) { toast("install failed: " + e.message); }
    loadComfy();
  };
  $("#comfySkip").onclick = async () => {
    await fetch(`${state.shim}/comfy/skip`, { method: "POST", body: "{}" }).catch(() => {});
    $("#comfySkip").hidden = true;
    toast("Skipped. Install it later from this panel.");
  };
  $("#comfyStart").onclick = async () => {
    toast("starting ComfyUI…");
    const r = await fetch(`${state.shim}/comfy/start`, { method: "POST", body: "{}" })
      .then((x) => x.json()).catch((e) => ({ ok: false, error: e.message }));
    toast(r.ok ? "ComfyUI is up" : "start failed: " + r.error);
    loadComfy();
  };
  $("#comfyBench").onclick = async () => {
    toast("rendering a test image — this can take a few minutes on CPU");
    const r = await fetch(`${state.shim}/comfy/benchmark`, { method: "POST", body: "{}" })
      .then((x) => x.json()).catch((e) => ({ ok: false, error: e.message }));
    toast(r.error ? "benchmark failed: " + r.error
      : `${(r.ms / 1000).toFixed(1)}s · settings locked to ${r.device}`);
    loadComfy();
  };
  $("#workflow").onchange = async (e) => {
    const r = await fetch(`${state.shim}/comfy/workflows/${e.target.value}`, { method: "PUT" })
      .then((x) => x.json()).catch((err) => ({ error: err.message }));
    toast(r.error ? "could not select: " + r.error : "workflow: " + e.target.value);
    loadComfy();
  };
  $("#workflowDelete").onclick = async () => {
    const id = $("#workflow").value;
    if (!confirm(`Delete the workflow "${id}"? Its downloaded weights stay on disk.`)) return;
    const r = await fetch(`${state.shim}/comfy/workflows/${id}`, { method: "DELETE" })
      .then((x) => x.json()).catch((err) => ({ error: err.message }));
    toast(r.error ? "could not delete: " + r.error : "deleted " + id);
    loadComfy();
  };
  $("#workflowAdd").onclick = () => $("#workflowFile").click();
  $("#workflowFile").onchange = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    try {
      const body = await file.text();
      // Validated server-side before it lands on disk, so a bad paste never
      // becomes a workflow that fails halfway through a render instead.
      const r = await fetch(`${state.shim}/comfy/workflows`, {
        method: "POST", headers: { "content-type": "application/json" }, body,
      }).then((x) => x.json());
      toast(r.error ? r.error : "added " + r.id);
    } catch (err) { toast("could not add: " + err.message); }
    loadComfy();
  };
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
  // The workbench routes on the hash, so the shell navigates it rather than
  // posting a message — a message needs a listener on the other side, and the
  // one this used to post had none, which is why the button did nothing.
  $("#openPlugs")?.addEventListener("click", () => {
    const frame = $("#frame");
    if (frame?.contentWindow) frame.contentWindow.location.hash = "#/mcp";
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
    wireComfy();
    const comfy = await loadComfy();
    // First run, nothing installed and never declined: show the offer once,
    // after the workbench is already usable. An 11GB download is not something
    // to put between the user and their work — but it is also not something to
    // leave buried in a panel they have no reason to open.
    if (comfy?.firstRun) {
      openDrawer(true);
      $("#imagesSection")?.scrollIntoView({ block: "nearest" });
    }
  }
})().catch((e) => fatal(String(e?.message || e)));
