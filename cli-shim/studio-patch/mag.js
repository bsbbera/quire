/* Quire — the Magazine section, added to InkOS Studio.
 *
 * Studio ships as a minified bundle with no source, so a new section cannot be
 * added the way its own sections are. Instead this clones Studio's own nav
 * markup (so the entry is indistinguishable from the built-in ones) and mounts
 * its workspace inside <main>, hiding Studio's view while it is open.
 *
 * All data comes from the Quire shim on :8787, not from Studio's API —
 * a magazine is not a book and Studio's engine knows nothing about it.
 */
(() => {
  "use strict";
  const SHIM = "http://127.0.0.1:8787";

  const h = (tag, attrs = {}, ...kids) => {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (k === "class") el.className = v;
      else if (k === "html") el.innerHTML = v;
      else if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
      else if (v != null && v !== false) el.setAttribute(k, v);
    }
    for (const kid of kids.flat()) {
      if (kid == null || kid === false) continue;
      el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
    }
    return el;
  };

  async function api(path, opts) {
    const r = await fetch(SHIM + path, {
      ...opts,
      headers: opts?.body ? { "content-type": "application/json" } : undefined,
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok || data.ok === false) throw new Error(data.error || `${r.status} ${path}`);
    return data;
  }

  /* ==================================================================== state */
  const S = { view: "issues", issue: null, page: null, issues: [], busy: null, log: [], queue: null };
  let root = null;      // our container inside <main>
  let hidden = [];      // Studio's own children, parked while we are mounted

  /* ==================================================================== nav */
  const ICON = (d) => `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16"
    viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
    stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;

  const ICONS = {
    issues: ICON('<path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1 0-5H20"/><path d="M8 7h8"/><path d="M8 11h5"/>'),
    create: ICON('<circle cx="12" cy="12" r="9"/><path d="M12 8v8M8 12h8"/>'),
    plugs:  ICON('<path d="M9 2v6M15 2v6"/><path d="M6 8h12v3a6 6 0 0 1-12 0z"/><path d="M12 17v5"/>'),
    update: ICON('<path d="M12 3v12"/><path d="M7 10l5 5 5-5"/><path d="M4 20h16"/>'),
  };

  /** Views that belong to Quire as a whole, not to the Magazine section. */
  const APPWIDE = new Set(["plugs"]);

  /** Clone Studio's own nav group so the section looks native, not bolted on. */
  function addNav() {
    const list = document.querySelector("aside > div.flex-1");
    if (!list || list.querySelector("[data-quire-mag]")) return;
    const model = list.firstElementChild;                     // "Start Creating"
    if (!model) return;
    const btnModel = model.querySelector("button");
    if (!btnModel) return;


    // Magazine is a kind of thing you create, so it belongs in Start Creating
    // beside Long Novel and Script rather than in a section of its own. A
    // second group for two buttons was structure without meaning.
    const grid = model.querySelector("div.grid") || model.lastElementChild;
    for (const [key, label] of [["issues", "Magazine"], ["create", "New Issue"]]) {
      if (!grid) break;
      const b = btnModel.cloneNode(true);
      b.setAttribute("data-quire-mag", "1");
      b.querySelector("span.shrink-0").innerHTML = ICONS[key];
      b.querySelector("span.truncate").textContent = label;
      // Route, do not just mount. Studio's own nav items navigate to a hash
      // route (#/book/new and friends); a section that hijacks <main> without
      // touching the URL has no back button, no deep link, and gets silently
      // wiped the next time Studio's router renders. Going through the hash
      // makes Magazine a peer of Long Novel rather than an overlay on top.
      b.addEventListener("click", (e) => {
        e.preventDefault(); e.stopPropagation();
        location.hash = key === "create" ? "#/magazine/new" : "#/magazine";
      });
      grid.append(b);
    }

    // Integrations and Updates are settings, not places to write, so they live
    // in the settings drawer now. Studio has no Tauri API, so opening the view
    // is a round trip: the drawer asks the shell, the shell asks back here.
    addEventListener("message", (e) => {
      if (e.data?.quire === "open-view" && e.data.view) open(e.data.view);
    });


    // Leaving is the router's job now: route() unmounts as soon as the hash
    // stops being ours, which also covers back/forward and deep links.
  }

  /* ================================================================== mount */
  function mount() {
    const main = document.querySelector("main");
    if (!main || root) return;
    hidden = [...main.children];
    for (const c of hidden) c.style.display = "none";
    root = h("div", { class: "mag-root", "data-quire-mag-root": "1" });
    main.append(root);
  }

  function unmount() {
    if (!root) return;
    markNav(null);
    root.remove(); root = null;
    for (const c of hidden) c.style.removeProperty("display");
    hidden = [];
  }

  /** Studio marks the open view in the sidebar; ours must too, or clicking
      Magazine looks like nothing happened even when the view did mount. */
  function markNav(view) {
    for (const b of document.querySelectorAll("[data-quire-mag]")) {
      const mine = view && b.textContent.trim() === (view === "create" ? "New Issue" : "Magazine");
      // Inline, not a stylesheet rule. Studio's Tailwind utilities are marked
      // !important inside a cascade layer, and for important declarations an
      // unlayered sheet has the LOWEST priority - so no injected CSS, however
      // specific, can repaint these buttons. Inline important still wins.
      if (mine) {
        b.setAttribute("aria-current", "page");
        // The clone carries Studio's `transition-all`, and a running transition
        // sits ABOVE author !important in the cascade - so both the inline
        // styles below and any injected stylesheet were being discarded while
        // the button looked completely unresponsive to a click. Pinning the
        // transition off is what actually lets the selected state paint.
        b.style.setProperty("transition", "none", "important");
        b.style.setProperty("background-color", "var(--secondary)", "important");
        b.style.setProperty("color", "var(--foreground)", "important");
      } else {
        b.removeAttribute("aria-current");
        b.style.removeProperty("transition");
        b.style.removeProperty("background-color");
        b.style.removeProperty("color");
      }
    }
  }

  async function open(view) {
    S.view = view;
    markNav(view);
    mount();
    render();
    if (view === "issues") { await refresh(); render(); }
    if (view === "plugs") { await loadIntegrations(); render(); }
  }

  async function refresh() {
    try {
      const d = await api("/mag/issues");
      S.issues = d.issues; S.busy = d.busy; S.root = d.root;
      if (S.issue) S.issue = await api("/mag/issue/" + S.issue.id);
    } catch (e) { S.error = e.message; }
  }

  /* ================================================================= render */
  function render() {
    if (!root) return;
    root.innerHTML = "";
    root.append(header());
    if (S.error) root.append(h("div", { class: "mag-err" }, S.error));
    if (S.view === "plugs") return root.append(integrations());
    if (S.view === "create") return root.append(createForm());
    if (S.issue) return root.append(issueView());
    root.append(issueList());
  }

  function header() {
    const running = S.busy || S.runState;
    // App-wide views are not "inside" Magazine, so they do not borrow its crumb.
    if (APPWIDE.has(S.view)) {
      return h("div", { class: "mag-head" },
        h("div", { class: "mag-crumb" }, h("span", {}, "Quire"),
          h("span", { class: "mag-sep" }, "/"), h("span", {}, "Integrations")),
        h("div", { class: "mag-spacer" }));
    }
    return h("div", { class: "mag-head" },
      h("div", { class: "mag-crumb" },
        h("button", { class: "mag-link", onclick: () => { location.hash = "#/magazine"; } }, "Magazine"),
        S.issue && h("span", { class: "mag-sep" }, "/"),
        S.issue && h("span", {}, S.issue.title || S.issue.subject)),
      h("div", { class: "mag-spacer" }),
      running && h("span", { class: "mag-run" }, h("i", {}), typeof running === "string" ? running : "running"),
      h("button", { class: "mag-btn", onclick: () => { location.hash = "#/magazine/new"; } }, "New issue"));
  }


  /* --------------------------------------------------------------- issues */
  function issueList() {
    if (!S.issues.length) {
      return h("div", { class: "mag-empty" },
        h("h2", {}, "No issues yet"),
        h("p", {}, "An issue starts from a subject and an angle. The pipeline researches it, "
          + "builds a flatplan, writes every page to its density, renders the art and lays out the PDF."),
        h("button", { class: "mag-btn", onclick: () => { location.hash = "#/magazine/new"; } }, "Start one"));
    }
    return h("div", { class: "mag-grid" }, S.issues.map((i) =>
      h("button", {
        class: "mag-card",
        onclick: () => { location.hash = "#/magazine/" + i.id; },
      },
        h("div", { class: "mag-card-t" }, i.title || i.subject),
        h("div", { class: "mag-card-s" }, i.subject + (i.angle ? " — " + i.angle : "")),
        h("div", { class: "mag-bars" },
          bar("written", i.written, i.pages || i.extent),
          bar("art", i.art, i.pages || i.extent)),
        h("div", { class: "mag-card-f" }, i.status, " · ", (i.pages || i.extent) + "pp",
          i.pdf ? " · PDF" : ""))));
  }

  const bar = (label, n, of) => h("div", { class: "mag-bar" },
    h("span", {}, label), h("i", { style: `width:${of ? (100 * n / of) : 0}%` }),
    h("b", {}, `${n}/${of || "?"}`));

  /* Every other "Start Creating" entry opens a composer: a centred prompt and
     one input at the foot of the window. A three-field form in that slot is
     what made Magazine feel bolted on, so this is the same shape - one line of
     natural language, parsed into subject / angle / extent. The old fields are
     still reachable underneath for anyone who wants to be exact. */
  function parseBrief(text) {
    let t = text.trim();
    let extent = 0;
    // "40pp", "40 pages", "in 24 pages"
    t = t.replace(/\b(?:in\s+)?(\d{2,3})\s*(?:pp|pages?)\b/i, (_, n) => { extent = +n; return ""; });
    // subject — angle, on an em dash, en dash, hyphen or comma
    const m = /^(.*?)\s*(?:—|–|\s-\s|,)\s*(.+)$/.exec(t.trim().replace(/[\s,;.]+$/, ''));
    const subject = (m ? m[1] : t).trim().replace(/[.,;]+$/, "");
    const angle = m ? m[2].trim().replace(/[.,;]+$/, "") : "";
    return { subject, angle, extent: extent || 40 };
  }

  function createForm() {
    const box = h("textarea", {
      class: "mag-composer-in",
      rows: "1",
      placeholder: "Film photography — the thing light touched, 40pp",
      autofocus: "1",
    });
    const msg = h("div", { class: "mag-note" });
    const echo = h("div", { class: "mag-composer-echo" });
    const go = h("button", { class: "mag-btn", type: "button" }, "Create issue");

    const readback = () => {
      const b = parseBrief(box.value);
      echo.textContent = b.subject
        ? `subject: ${b.subject}${b.angle ? "   ·   angle: " + b.angle : ""}   ·   ${b.extent}pp`
        : "";
      go.disabled = !b.subject;
    };
    box.addEventListener("input", () => {
      box.style.height = "auto";
      box.style.height = Math.min(box.scrollHeight, 180) + "px";
      readback();
    });

    const submit = async () => {
      const b = parseBrief(box.value);
      if (!b.subject) return;
      go.disabled = true; msg.textContent = "creating…";
      try {
        const issue = await api("/mag/issues", { method: "POST", body: JSON.stringify(b) });
        location.hash = "#/magazine/" + issue.id;
      } catch (e) { msg.textContent = e.message; go.disabled = false; }
    };
    go.addEventListener("click", submit);
    // Enter sends, shift+Enter breaks the line - the same contract as Studio's.
    box.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submit(); }
    });
    readback();

    return h("div", { class: "mag-composer" },
      h("div", { class: "mag-composer-hero" },
        h("div", { class: "mag-composer-badge", html: ICONS.issues }),
        h("p", {},
          "Tell me what the issue is about — subject, the angle you want on it, how long."),
        h("p", { class: "mag-composer-eg" },
          "Film photography — the thing light touched, 40pp")),
      h("div", { class: "mag-composer-bar" },
        h("div", { class: "mag-composer-field" },
          box,
          h("div", { class: "mag-composer-foot" }, echo, h("span", { class: "mag-spacer" }), msg, go)),
        h("p", { class: "mag-note" },
          "Extent rounds to an even number: every section opens with a full-page plate on a "
          + "right-hand page, so sections — and the issue — have to be even.")));
  }

  /* ---------------------------------------------------------------- issue */
  const STAGES = ["research", "plan", "design", "write", "art", "build"];

  function issueView() {
    const i = S.issue;
    if (S.page != null) return pageView();
    return h("div", { class: "mag-issue" },
      h("div", { class: "mag-meta" },
        h("h1", {}, i.title || i.subject),
        i.thesis && h("p", { class: "mag-thesis" }, i.thesis),
        h("div", { class: "mag-row" }, STAGES.map(stageBtn), h("span", { class: "mag-spacer" }),
          // Not "run all" any more: this stops at the end of the write stage.
          h("button", { class: "mag-btn", onclick: () => runFrom("research") }, "Write the issue")),
        notesBox(i),
        h("div", { class: "mag-log" }, S.log.slice(-8).map((l) => h("div", {}, l)))),
      designView(i),
      approvalGate(i),
      queueBar(i),
      i.lastError && h("div", { class: "mag-err" },
        `${i.lastError.stage} failed: ${i.lastError.error}`),
      (i.warnings || []).length && h("div", { class: "mag-warn" },
        h("b", {}, "Flatplan check"),
        h("ul", {}, i.warnings.map((x) => h("li", {}, x)))),
      i.research && researchView(i.research),
      i.pages?.length ? flatplan(i) : h("p", { class: "mag-note" }, "No flatplan yet — run research, then plan."));
  }

  /**
   * The preference step: pick a register before the design stage runs, or leave
   * it and let the model choose. Only Tier 1 systems are offered — the other
   * thirty-six cannot run a page on their own, and offering them is a trap.
   */
  function designPrefs(i) {
    const p = i.designPrefs || {};
    const opts = (list, cur, blank) =>
      [h("option", { value: "" }, blank)].concat((list || []).map((n) =>
        h("option", { value: n, selected: n === cur || undefined }, n)));
    const set = async (patch) => {
      try { await api(`/mag/issue/${i.id}/design`, { method: "POST", body: JSON.stringify({ ...p, ...patch }) }); }
      catch (e) { S.error = e.message; }
      S.issue = await api("/mag/issue/" + i.id);
      render();
    };
    return h("details", { class: "mag-bucket", open: !i.design || undefined },
      h("summary", {}, "Design preference", h("b", {},
        p.register ? ` ${p.register}${p.technique ? " × " + p.technique : ""}` : " model chooses")),
      h("div", { class: "mag-row" },
        h("select", {
          class: "mag-in", onchange: (e) => set({ register: e.target.value }),
        }, opts(INT.registers, p.register, "register — model chooses")),
        h("select", {
          class: "mag-in", onchange: (e) => set({ technique: e.target.value }),
        }, opts(INT.techniques, p.technique, "figure technique — model chooses"))),
      h("label", { class: "mag-row" },
        h("input", {
          type: "checkbox", checked: p.single || undefined,
          onchange: (e) => set({ single: e.target.checked }),
        }),
        h("span", { class: "mag-note" },
          "One register for the whole issue — sections differ by palette only. "
          + "What a book wants; rarely what a magazine with real section doors wants.")),
      h("textarea", {
        class: "mag-in mag-notes", placeholder: "anything else the design must obey",
        onchange: (e) => set({ note: e.target.value }),
      }, p.note || ""));
  }

  /** The design decisions, and anything the law says is wrong with them. */
  function designView(i) {
    const d = i.design;
    if (!d) return designPrefs(i);
    const bad = d.violations || [];
    return h("div", { class: "mag-design" },
      h("h3", {}, "Design system"),
      designPrefs(i),
      d.register_note && h("p", { class: "mag-thesis" }, d.register_note),
      bad.length
        ? h("div", { class: "mag-warn" }, h("b", {}, "Against the design law"),
            h("ul", {}, bad.map((x) => h("li", {}, x))))
        : h("p", { class: "mag-note" }, "Every section passes the register, contrast and typeface rules."),
      h("div", { class: "mag-worlds" }, (d.sections || []).map((w) => h("div", { class: "mag-world" },
        h("div", { class: "mag-swatches" },
          ["paper", "field", "hue", "ink"].map((k) =>
            h("i", { style: `background:${w[k]}`, title: `${k} ${w[k]}` }))),
        h("b", {}, `s${w.n} · ${w.register}`, w.technique ? h("span", { class: "mag-note" }, " × " + w.technique) : null),
        h("div", { class: "mag-note" }, Object.values(w.typefaces || {}).join(" · ")),
        h("div", { class: "mag-idiom" }, w.idiom || ""),
        w.why && h("div", { class: "mag-note" }, w.why)))));
  }

  /**
   * Art and build are queues. They are started by hand, run one page at a time,
   * and can be stopped between pages — the two heaviest things on the machine
   * should not be holding memory because a run was left going.
   */
  function queueBar(i) {
    const q = S.queue;
    const live = q && !q.done && q.id === i.id;
    // A stopped run's own remaining list beats a re-derived one: a re-render
    // that was interrupted has pages waiting that all still have art.
    const pend = i.pending;
    const artLeft = pend?.kind === "art" ? pend.pages.length
      : (i.pages || []).filter((p) => p.brief?.prompt && !p.image).length;
    const buildLeft = pend?.kind === "build" ? pend.pages.length
      : (i.pages || []).filter((p) => !p.built).length;

    if (live) {
      return h("div", { class: "mag-gate" },
        h("div", {},
          h("b", {}, `${q.kind === "art" ? "Rendering" : "Laying out"} page ${q.current ?? "—"}`),
          h("div", { class: "mag-note" },
            `${q.completed} of ${q.total} done` + (q.failed?.length ? ` · ${q.failed.length} failed` : "")
            + (q.stopping ? " · stopping after this page" : ""))),
        h("span", { class: "mag-spacer" }),
        h("button", {
          class: "mag-btn ghost", disabled: q.stopping || undefined,
          onclick: async () => { try { await api(`/mag/issue/${i.id}/queue`, { method: "DELETE" }); } catch (e) { S.error = e.message; } },
        }, q.stopping ? "stopping…" : "Stop"));
    }

    if (!i.approved) return null;
    const start = (kind) => async () => {
      try { await api(`/mag/issue/${i.id}/queue`, { method: "POST", body: JSON.stringify({ kind }) }); }
      catch (e) { S.error = e.message; }
      render();
    };
    return h("div", { class: "mag-gate ok" },
      h("div", {},
        h("b", {}, "Ready to render"),
        h("div", { class: "mag-note" },
          `${artLeft} page(s) need art, ${buildLeft} need laying out. `
          + "Both run one page at a time and can be stopped and resumed.")),
      h("span", { class: "mag-spacer" }),
      artLeft > 0 && h("button", { class: "mag-btn", onclick: start("art") },
        artLeft === (i.pages || []).length ? "Render art" : `Resume art (${artLeft} left)`),
      h("button", { class: "mag-btn", onclick: start("build") },
        buildLeft === (i.pages || []).length ? "Build pages" : `Resume build (${buildLeft} left)`));
  }

  /**
   * The one manual step in the pipeline. Everything before it is text this
   * shim can regenerate for free; everything after it spends GPU time and
   * drives a live Affinity document, so it waits for a person to read the copy.
   */
  function approvalGate(i) {
    const total = i.pages?.length || 0;
    if (!total) return null;
    const written = i.pages.filter((p) => p.body !== null && p.body !== undefined).length;

    if (i.approved) {
      return h("div", { class: "mag-gate ok" },
        h("div", {},
          h("b", {}, "Content approved"),
          h("div", { class: "mag-note" },
            "Art and build are unlocked. Rewriting any page withdraws this.")),
        h("span", { class: "mag-spacer" }),
        h("button", {
          class: "mag-btn ghost",
          onclick: async () => {
            try { S.issue = await api(`/mag/issue/${i.id}/approve`,
              { method: "POST", body: JSON.stringify({ approved: false }) }); }
            catch (e) { S.error = e.message; }
            render();
          },
        }, "Withdraw"));
    }

    return h("div", { class: "mag-gate" },
      h("div", {},
        h("b", {}, written < total ? `${written} of ${total} pages written` : "Ready for review"),
        h("div", { class: "mag-note" }, written < total
          ? "Art and layout stay locked until every page is written and approved."
          : "Read the pages, then approve. Nothing renders or lays out before that.")),
      h("span", { class: "mag-spacer" }),
      h("button", {
        class: "mag-btn",
        disabled: written < total || undefined,
        onclick: async () => {
          try { S.issue = await api(`/mag/issue/${i.id}/approve`, { method: "POST", body: "{}" }); }
          catch (e) { S.error = e.message; }
          render();
        },
      }, "Approve content"));
  }

  /** The editor's own material. Weighted above the model's research. */
  function notesBox(i) {
    const ta = h("textarea", {
      class: "mag-in mag-notes",
      rows: "3",
      placeholder: "Your own material — sources, corrections, an angle, someone to interview, "
        + "a fact the model will not know. Used by every stage, and it outranks the research.",
    });
    ta.value = i.notes || "";
    const save = h("button", { class: "mag-btn ghost" }, "Save notes");
    save.addEventListener("click", async () => {
      save.disabled = true; save.textContent = "saving…";
      try { await api(`/mag/issue/${i.id}/notes`, { method: "POST", body: JSON.stringify({ notes: ta.value }) }); }
      catch (e) { S.log.push("! " + e.message); }
      S.issue = await api("/mag/issue/" + i.id);
      render();
    });
    return h("details", { class: "mag-bucket", open: i.notes ? "1" : false },
      h("summary", {}, "Your material", h("b", {}, i.notes ? "saved" : "empty")),
      h("div", { class: "mag-row" }, ta), h("div", { class: "mag-row" }, save));
  }

  const GATED = new Set(["art", "build"]);

  const stageBtn = (s) => {
    const locked = GATED.has(s) && !S.issue?.approved;
    return h("button", {
      class: "mag-btn ghost",
      disabled: locked || undefined,
      title: locked ? "Approve the content first" : "",
      // Art and build run alone. Firing "run from art" would also sweep the
      // build stage in behind it, which is the thing approval exists to stop.
      onclick: () => (GATED.has(s) ? runOnly(s) : runFrom(s)),
    }, s);
  };

  /** Run exactly one gated stage, nothing after it. */
  async function runOnly(stage) {
    S.log.push("→ " + stage);
    S.runState = stage;
    render();
    try {
      await api(`/mag/issue/${S.issue.id}/run`,
        { method: "POST", body: JSON.stringify({ from: stage, stopAt: stage }) });
    } catch (e) { S.log.push("! " + e.message); S.runState = null; render(); }
  }

  async function runFrom(from) {
    S.log.push("→ " + from);
    S.runState = from;
    render();
    try { await api(`/mag/issue/${S.issue.id}/run`, { method: "POST", body: JSON.stringify({ from }) }); }
    catch (e) { S.log.push("! " + e.message); S.runState = null; render(); }
  }

  function researchView(r) {
    const bucket = (key, label) => (r[key] || []).length && h("details", { class: "mag-bucket" },
      h("summary", {}, label, h("b", {}, (r[key] || []).length)),
      h("ul", {}, (r[key] || []).map((x) =>
        h("li", {}, x.fact || x.idea || x.what || JSON.stringify(x),
          x.who && h("i", {}, " — " + x.who),
          x.when && h("i", {}, " (" + x.when + ")"),
          x.the_number && h("b", {}, " " + x.the_number)))));
    return h("div", { class: "mag-research" },
      bucket("origin", "Origin"), bucket("evolution", "Evolution"), bucket("today", "Today"),
      bucket("strange", "Strange facts"), bucket("underlying", "Science, maths, philosophy"),
      bucket("real_work", "Real work"),
      (r.uncertain || []).length && h("details", { class: "mag-bucket warn" },
        h("summary", {}, "Flagged as uncertain", h("b", {}, r.uncertain.length)),
        h("ul", {}, r.uncertain.map((u) => h("li", {}, u)))));
  }

  /** The flatplan, drawn as spreads — the unit a reader actually sees. */
  function flatplan(i) {
    const spreads = [];
    for (const p of i.pages) {
      // p1 stands alone (the cover), then 2-3, 4-5, and so on.
      const key = p.n === 1 ? 0 : Math.floor(p.n / 2);
      (spreads[key] ||= []).push(p);
    }
    return h("div", { class: "mag-flat" }, spreads.filter(Boolean).map((pair) =>
      h("div", { class: "mag-spread" }, pair.map((p) => pageChip(p, i)))));
  }

  function pageChip(p, i) {
    const sec = (i.sections || []).find((s) => s.n === p.section);
    return h("button", {
      class: `mag-page d-${p.density} ${p.body != null ? "written" : ""} ${p.image ? "arted" : ""}`,
      title: p.premise || "",
      onclick: () => { S.page = p.n; render(); },
    },
      p.image && h("img", { src: `${SHIM}/mag/issue/${i.id}/asset/${p.n}`, loading: "lazy", alt: "" }),
      h("span", { class: "mag-n" }, p.n),
      h("span", { class: "mag-ty" }, p.type),
      h("span", { class: "mag-ti" }, p.title || "—"),
      sec && h("span", { class: "mag-sec" }, sec.label));
  }

  /* ----------------------------------------------------------------- page */
  function pageView() {
    const i = S.issue;
    const p = i.pages.find((x) => x.n === S.page);
    if (!p) { S.page = null; return render(); }
    const act = async (verb) => {
      S.log.push(`→ ${verb} p${p.n}`); render();
      try {
        await api(`/mag/issue/${i.id}/${verb}/${p.n}`, { method: "POST" });
        S.issue = await api("/mag/issue/" + i.id);
      } catch (e) { S.log.push("! " + e.message); }
      render();
    };
    return h("div", { class: "mag-pageview" },
      h("div", { class: "mag-row" },
        h("button", { class: "mag-link", onclick: () => { S.page = null; render(); } }, "← flatplan"),
        h("span", { class: "mag-spacer" }),
        h("button", { class: "mag-btn ghost", onclick: () => act("write") }, p.body != null ? "Rewrite" : "Write"),
        h("button", {
          class: "mag-btn ghost",
          disabled: !i.approved || undefined,
          title: i.approved ? "" : "Approve the content first",
          onclick: () => act("art"),
        }, p.image ? "Re-render" : "Render art")),
      h("div", { class: "mag-proof" },
        h("div", { class: "mag-copy" },
          h("div", { class: "mag-kicker" }, `p${p.n} · ${p.type} · ${p.density}`
            + (p.words ? ` · ${p.words} words` : "")),
          h("h1", {}, p.title || "—"),
          p.deck && h("p", { class: "mag-deck" }, p.deck),
          p.pullQuote && h("blockquote", {}, p.pullQuote),
          ...String(p.body || "").split(/\n{2,}/).filter(Boolean).map((t) => h("p", {}, t)),
          (p.furniture || []).length && h("div", { class: "mag-furn" }, p.furniture.map((f) =>
            h("div", {}, h("b", {}, f.kind), f.text))),
          (p.uncertain || []).length && h("div", { class: "mag-warn" },
            h("b", {}, "Flagged as uncertain"), h("ul", {}, p.uncertain.map((u) => h("li", {}, u)))),
          (p.sources || []).filter(Boolean).length && h("div", { class: "mag-note" },
            "Sources: " + p.sources.filter(Boolean).join("; "))),
        h("div", { class: "mag-art" },
          p.image
            ? h("img", { src: `${SHIM}/mag/issue/${i.id}/asset/${p.n}?t=${Date.now()}`, alt: "" })
            : h("div", { class: "mag-noart" }, "no art yet"),
          p.brief?.prompt && h("p", { class: "mag-brief" }, h("b", {}, "visual brief "), p.brief.prompt))));
  }

  /* --------------------------------------------------------- integrations */
  const INT = { servers: {}, tools: {}, comfy: null, registers: null, techniques: null };

  const gb = (n) => (n / 1e9).toFixed(1) + "GB";

  // A 17GB install outlives any single render, so the panel polls rather than
  // holding the request open. Stops as soon as the job reports done.
  let pollTimer = null;
  function pollInstall() {
    clearInterval(pollTimer);
    pollTimer = setInterval(async () => {
      try { INT.comfy = await api("/comfy/status"); } catch { return; }
      if (INT.comfy.install?.done) { clearInterval(pollTimer); await loadIntegrations(); }
      if (S.view === "plugs") render();
    }, 1500);
  }

  // The 50, fetched once: the picker needs the names, and only the shim knows
  // which tier each one is in.
  async function loadStyles() {
    if (INT.registers) return;
    try {
      const r = await api("/mag/styles");
      INT.registers = r.registers;
      INT.techniques = r.styles.filter((s) => s.tier === 2).map((s) => s.name);
    } catch { INT.registers = []; INT.techniques = []; }
  }

  async function loadIntegrations() {
    try {
      INT.servers = (await api("/mcp/servers")).servers;
      [INT.comfy, INT.affinity, INT.doctor] = await Promise.all([
        api("/comfy/status"), api("/affinity/status"), api("/doctor"),
      ]);
      // An install started before this panel was reopened is still running in
      // the shim; pick its progress back up rather than showing a dead bar.
      if (INT.comfy.install && !INT.comfy.install.done && !pollTimer) pollInstall();
    } catch (e) { S.error = e.message; }
  }

  function integrations() {
    const dr = INT.doctor;
    const job = INT.comfy?.install;
    return h("div", { class: "mag-int" },
      h("h2", {}, "Setup"),
      dr && h("p", { class: "mag-note" }, dr.ok
        ? "Everything Quire needs is present. Anything below marked optional only "
          + "limits one stage — the rest of the pipeline still runs without it."
        : `${dr.blocking} thing${dr.blocking > 1 ? "s" : ""} must be installed before `
          + "Quire can write anything."),
      (dr?.checks || []).map((c) => h("div", { class: "mag-srv" },
        h("span", { class: "mag-dot " + (c.ok ? "on" : c.severity === "required" ? "bad" : "off") }),
        h("div", {},
          h("b", {}, c.label),
          h("div", { class: "mag-note" }, c.detail),
          !c.ok && h("div", { class: "mag-fix" },
            h("b", {}, c.severity === "required" ? "Required" : "Optional"), " ", c.fix)))),

      h("h2", {}, "ComfyUI"),
      h("div", { class: "mag-srv" },
        h("span", { class: "mag-dot " + (INT.comfy?.up ? "on" : INT.comfy?.installed ? "off" : "bad") }),
        h("div", {}, h("b", {}, INT.comfy?.up ? "running" : INT.comfy?.installed ? "installed, not running" : "not found"),
          h("div", { class: "mag-note" }, INT.comfy?.dir || "nothing found on this machine")),
        h("span", { class: "mag-spacer" }),
        !INT.comfy?.up && INT.comfy?.installed && h("button", {
          class: "mag-btn ghost",
          onclick: async (e) => {
            e.target.disabled = true; e.target.textContent = "starting… (model load takes a minute)";
            try { await api("/comfy/start", { method: "POST" }); } catch (err) { S.error = err.message; }
            await loadIntegrations(); render();
          },
        }, "Start"),
        !INT.comfy?.installed && !job && h("button", {
          class: "mag-btn ghost",
          onclick: async () => {
            try { INT.plan = await api("/comfy/install-plan"); } catch (e) { S.error = e.message; }
            render();
          },
        }, "Install")),

      // Sizes come from the real release and a HEAD on each weight, so the
      // number shown is the number downloaded — a ~17GB commitment is not
      // something to start behind the user's back.
      !INT.comfy?.installed && INT.plan && !job && h("div", { class: "mag-warn" },
        h("div", {}, `ComfyUI ${INT.plan.version} for ${INT.plan.vendor}, plus the three `
          + `checkpoints the editorial workflow loads — `
          + `${gb(INT.plan.bytes)} to download into ${INT.plan.dir}.`),
        INT.plan.enoughSpace
          ? h("div", { class: "mag-note" }, `${gb(INT.plan.free)} free on that drive; `
              + `${gb(INT.plan.needed)} needed with room to unpack.`)
          : h("div", { class: "mag-note" }, `Not enough room: ${gb(INT.plan.needed)} needed, `
              + `${gb(INT.plan.free)} free.`),
        h("div", { class: "mag-row" },
          INT.plan.enoughSpace && h("button", {
            class: "mag-btn",
            onclick: async (e) => {
              e.target.disabled = true;
              try { await api("/comfy/install", { method: "POST", body: JSON.stringify({ dir: INT.plan.dir }) }); }
              catch (err) { S.error = err.message; }
              pollInstall();
            },
          }, "Download and install"),
          h("button", { class: "mag-btn ghost", onclick: () => { INT.plan = null; render(); } }, "Cancel"))),

      job && h("div", { class: "mag-warn" },
        h("div", {}, job.error ? "Install failed: " + job.error
          : job.done ? "ComfyUI installed. Start it above."
          : `Installing: ${job.step}`),
        !job.done && job.total > 0 && h("div", { class: "mag-prog" },
          h("i", { style: `transform:scaleX(${(job.got / job.total).toFixed(3)})` })),
        !job.done && job.total > 0 && h("div", { class: "mag-note" },
          `${gb(job.got)} of ${gb(job.total)}`),
        !job.done && h("div", { class: "mag-note" },
          "Interrupting is safe. Each file resumes where it stopped.")),

      h("h2", {}, "Affinity"),
      h("div", { class: "mag-srv" },
        h("span", { class: "mag-dot " + (INT.affinity?.up ? "on" : "bad") }),
        h("div", {},
          h("b", {}, INT.affinity?.up ? "connected" : "not connected"),
          h("div", { class: "mag-note" }, INT.affinity?.up
            ? "Layout and PDF export are available."
            : INT.affinity?.reason || ""))),

      h("h2", {}, "MCP servers"),
      h("p", { class: "mag-note" },
        "Read from the configs already on this machine — Claude Desktop extensions, Claude Code "
        + "and Codex. Nothing is duplicated here; disabling one only affects Quire."),
      Object.entries(INT.servers).map(([name, cfg]) => {
        const tools = INT.tools[name];
        return h("div", { class: "mag-srv" },
          h("span", { class: "mag-dot " + (cfg.needsConfig ? "bad" : cfg.enabled ? "on" : "off") }),
          h("div", {},
            h("b", {}, name),
            h("div", { class: "mag-note" },
              cfg.source,
              cfg.needsConfig ? " · needs configuring in Claude" : "",
              tools ? ` · ${tools.length} tools` : "",
              tools?.error ? " · " + tools.error : "")),
          h("span", { class: "mag-spacer" }),
          h("button", {
            class: "mag-btn ghost",
            onclick: async (e) => {
              e.target.disabled = true;
              try { INT.tools[name] = (await api("/mcp/tools?server=" + name)).tools; }
              catch (err) { INT.tools[name] = Object.assign([], { error: err.message }); }
              render();
            },
          }, "Probe"),
          h("button", {
            class: "mag-btn ghost",
            onclick: async () => {
              await api("/mcp/toggle", { method: "POST", body: JSON.stringify({ server: name, enabled: !cfg.enabled }) });
              await loadIntegrations(); render();
            },
          }, cfg.enabled ? "Disable" : "Enable"),
          tools?.length ? h("div", { class: "mag-tools" }, tools.map((t) => h("code", { title: t.description || "" }, t.name))) : null);
      }));
  }

  /* ================================================================ events */
  function connect() {
    const es = new EventSource(SHIM + "/mag/events");
    es.onmessage = async (ev) => {
      let d; try { d = JSON.parse(ev.data); } catch { return; }
      if (d.type === "mag:stage") {
        S.runState = d.stage + (d.page ? " p" + d.page : "") + (d.state === "start" ? "…" : "");
        S.log.push(`${d.state === "error" ? "!" : "·"} ${d.stage}${d.page ? " p" + d.page : ""}`
          + (d.words ? ` ${d.words}w` : "") + (d.error ? " " + d.error : ""));
      }
      if (d.type === "mag:queue") {
        if (d.aborted) S.error = d.aborted;
        S.queue = ["done", "stopped", "aborted"].includes(d.state) ? null : d;
        S.log.push(`· ${d.kind} p${d.current ?? "-"} ${d.state}`);
      }
      if (d.type === "mag:run" && d.state !== "start") {
        S.runState = null;
        S.log.push(d.state === "error" ? "! " + d.error : "✓ done");
      }
      if (!root) return;
      // Refresh on stage boundaries only — a redraw per token would thrash.
      if (d.type === "mag:issue" || (d.type === "mag:stage" && d.state !== "start")) {
        if (S.issue) { try { S.issue = await api("/mag/issue/" + S.issue.id); } catch {} }
        else if (S.view === "issues") await refresh();
      }
      render();
    };
  }

  /* ================================================================= router */
  /** Our slice of Studio's hash router: #/magazine, /new, /<issue id>. */
  function route() {
    const m = /^#\/magazine(?:\/([^/?]+))?/.exec(location.hash || "");
    if (!m) return unmount();                 // Studio owns the view again
    const seg = m[1];
    if (seg === "new") return open("create");
    if (seg) {
      // Deep link straight to an issue.
      return (async () => {
        try { S.issue = await api("/mag/issue/" + seg); } catch { S.issue = null; }
        S.view = "issue";
        markNav("issues"); mount(); await loadStyles(); render();
      })();
    }
    S.issue = null; S.page = null;
    return open("issues");
  }

  /* ================================================================== boot */
  function boot() {
    addNav();
    addEventListener("hashchange", route);
    route();
    new MutationObserver(() => {
      addNav();
      // A cold load straight onto #/magazine reaches boot() before Studio's
      // React has painted <main>, so the first route() has nothing to mount
      // into and the deep link silently lands on an empty page. Retry while
      // the hash is ours and nothing is mounted; route() is a no-op otherwise.
      if (!root && /^#\/magazine/.test(location.hash || "")) route();
    }).observe(document.body, { childList: true, subtree: true });
    connect();
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot, { once: true });
  else boot();
})();
