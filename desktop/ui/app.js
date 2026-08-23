// InkDesk shell frontend. Starts the services once via Rust, then hands the
// window over to Studio. Model/provider settings live in the drawer.
const invoke = window.__TAURI__?.core?.invoke;

const $ = (s) => document.querySelector(s);
const state = { shim: "http://127.0.0.1:8787", studio: "", models: [], cli: null, model: null };

const savedTheme = localStorage.getItem("inkdesk-theme");
if (savedTheme) document.documentElement.dataset.theme = savedTheme;
$("#theme").onclick = () => {
  const cur = document.documentElement.dataset.theme
    || (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
  const next = cur === "dark" ? "light" : "dark";
  document.documentElement.dataset.theme = next;
  localStorage.setItem("inkdesk-theme", next);
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
  $("#foot").textContent = `shim :${status.port} · ${status.agents.length} CLIs · ${status.total} models`;
  $("#langFoot").textContent = "lang " + status.lang;
  renderProviders(status.agents);
  renderModels();
}

function mark(el, ok) {
  el.classList.toggle("done", ok);
  el.classList.toggle("fail", !ok);
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
  const boot = await invoke("boot");
  state.shim = boot.shim_url;
  state.studio = boot.studio_url;
  mark($("#stepShim"), boot.shim_ready);
  mark($("#stepStudio"), boot.studio_ready);
  if (boot.notes.length) $("#notes").textContent = boot.notes.join("\n");

  if (!boot.studio_ready) {
    $("#sub").textContent = "InkOS Studio did not start";
    return;
  }

  // Studio takes the window; the cover only lifts once it has actually painted.
  const frame = $("#frame");
  frame.hidden = false;
  frame.src = state.studio;
  const lift = () => { $("#cover").hidden = true; };
  frame.addEventListener("load", lift, { once: true });
  // The port already answered, so never let a missing load event strand the
  // window on the boot cover.
  setTimeout(lift, 8000);

  if (boot.shim_ready) {
    $("#openSettings").hidden = false;
    try {
      await loadShim(false);
    } catch (e) {
      toast("shim unreachable: " + e.message);
    }
  }
})().catch((e) => fatal(String(e?.message || e)));
