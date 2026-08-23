// Affinity connector: create the document, lay the issue out, export the PDF.
//
// Three facts about the Affinity JS SDK shape this file, all established by
// probing the running application rather than assumed:
//
//  1. It is not a "place a text box" API. It is a command/definition graph with
//     real traps (document-px not points, faces by traitsName, no exported
//     Selection). The user already paid for that knowledge once, in
//     affinity/tk.js — this drives that toolkit rather than re-deriving it.
//  2. Scripts may only touch the Desktop, so the issue's images are staged into
//     a folder there before the document can place them.
//  3. Text cannot flow between frames from script (verified by probe, see
//     EDITORIAL-METHOD section 3). Body copy is therefore poured column by
//     column, with break points found by measuring overflow rather than guessed.
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as mcp from "./mcp.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
// Read per build, not once at import: editing the toolkit should not need a
// restart of the shim to take effect.
const TK = () => readFileSync(join(HERE, "affinity", "tk.js"), "utf8");

const win = (p) => String(p).replace(/\//g, "\\");

// The Affinity MCP refuses every call until its preamble has been read once
// per session — including execute_script, which fails with a message about
// documentation rather than anything script-shaped. Any restart of the shim
// starts a new session, so this is checked rather than assumed.
let preambleRead = false;
async function ensurePreamble() {
  if (preambleRead) return;
  await mcp.call("affinity", "read_sdk_documentation_topic", { filename: "preamble" }, 60000);
  preambleRead = true;
}

/** Run one script in Affinity and parse the JSON its console.log prints. */
async function run(script, ms = 300000) {
  await ensurePreamble();
  let r = await mcp.call("affinity", "execute_script", { script }, ms);
  if (/preamble documentation topic has not yet been read/i.test(String(r.text))) {
    preambleRead = false;
    await ensurePreamble();
    r = await mcp.call("affinity", "execute_script", { script }, ms);
  }
  const text = String(r.text || "").trim();
  const m = /\{[\s\S]*\}$/.exec(text);
  if (!m) return { raw: text };
  try { return JSON.parse(m[0]); } catch { return { raw: text }; }
}

export async function status() {
  try {
    const out = await run(`
      const { app } = require("/application");
      const { fs } = require("/fs");
      const o = { desktop: app.userDesktopPath, version: app.shortVersion };
      // The /fs write API is denied here while doc.export is allowed — they are
      // separate permissions. So this reports whether the sandbox can be read
      // at all, and export is left to report its own failure rather than being
      // pre-judged by a probe that measures the wrong thing.
      try { o.canRead = fs.isDirectory(app.userDesktopPath); }
      catch (e) { o.canRead = false; o.readError = e.message; }
      console.log(JSON.stringify(o));`, 30000);
    return {
      up: true,
      desktop: out.desktop,
      version: out.version,
      canRead: !!out.canRead,
      reason: out.canRead ? null
        : "Affinity's scripting sandbox cannot read the Desktop, so page art cannot "
          + "be placed. Check filesystem access in Affinity's settings.",
    };
  } catch (e) {
    const off = /not running|not enabled/i.test(e.message);
    return {
      up: false,
      reason: off
        ? "Affinity is not running, or its MCP server is off (Settings > MCP Server)"
        : e.message,
    };
  }
}

/**
 * Copy the issue's art onto the Desktop. Affinity's scripting sandbox can only
 * reach files there, and the issue lives in the magazine folder — so without
 * this every image silently fails to place.
 */
function stageAssets(issue, issueDir, desktop) {
  const dest = join(desktop, "Quire", issue.id, "_assets");
  mkdirSync(dest, { recursive: true });
  const src = join(issueDir, "_assets");
  const staged = {};
  if (existsSync(src)) {
    for (const f of readdirSync(src).filter((f) => /\.(png|jpe?g)$/i.test(f))) {
      copyFileSync(join(src, f), join(dest, f));
      staged[f] = win(join(dest, f));
    }
  }
  return { dir: dest, staged };
}

/**
 * A4, facing, one spread per opening — the geometry tk.js assumes.
 *
 * Create, toolkit, layout and export are one script on purpose: each
 * execute_script call is a fresh context, so globalThis.TK and globalThis.TK_DOC
 * do not survive between calls. Splitting them fails with "toolkit not loaded".
 */
const CREATE = (pages) => `
  const { Document, NewDocumentOptions, UnitType } = require("/document");
  const _o = NewDocumentOptions.createDefault();
  _o.units = UnitType.Millimetre;
  _o.width = 210; _o.height = 297; _o.dpi = 300;
  _o.pageCount = ${pages};
  _o.isFacing = true; _o.isMultiPage = true;
  // tk.js reads globalThis.TK_DOC: app.documents.current follows the active
  // window, which is not reliable while a build is running.
  globalThis.TK_DOC = Document.createFromOptions(_o);`;

/**
 * The layout, as one script. Runs after tk.js has defined globalThis.TK.
 *
 * Archetypes come from EDITORIAL-METHOD section 4: having them is the whole
 * point, because "big picture + big word" on every spread is the exact failure
 * the method was written to fix.
 */
function layoutScript(issue, staged) {
  const pages = issue.pages.map((p) => ({
    n: p.n, type: p.type, density: p.density, section: p.section,
    title: p.title || "", deck: p.deck || "", body: p.body || "",
    pull: p.pullQuote || "", furniture: (p.furniture || []).slice(0, 4),
    image: staged[String(p.n).padStart(2, "0") + ".png"] || null,
  }));

  return `(function () {
  const T = globalThis.TK;
  if (!T) throw new Error("toolkit not loaded");
  const PAGES = ${JSON.stringify(pages)};
  const TITLE = ${JSON.stringify(issue.title || issue.subject)};
  const C = T.C, F = T.F, FACE = T.FACE;
  const log = [];

  // Pour text into one column and return what did not fit. Overflow is the
  // only measurement the SDK exposes, so the fit is found by bisection.
  function pour(P, x, y, w, h, words, style) {
    if (!words.length) return [];
    var lo = 1, hi = words.length, best = 0;
    while (lo <= hi) {
      var mid = (lo + hi) >> 1;
      var n = T.text(P, x, y, w, h, [{ t: words.slice(0, mid).join(" ") }],
        Object.assign({ tag: "mag-probe", align: "Justify", hyph: true }, style || {}));
      if (T.overflows(n)) hi = mid - 1; else { best = mid; lo = mid + 1; }
    }
    T.kill("mag-probe", [P]);
    if (!best) { log.push("p" + P + ": no room for body"); return words; }
    T.text(P, x, y, w, h, [{ t: words.slice(0, best).join(" ") }],
      Object.assign({ tag: "mag", align: "Justify", hyph: true }, style || {}));
    return words.slice(best);
  }

  function folio(p) {
    if (p.n === 1 || p.type === "plate") return;   // a plate carries no folio
    var L = T.live(p.n);
    T.text(p.n, L.recto ? L.x1 - 20 : L.x0, 277, 20, 6,
      [{ t: String(p.n), fam: F.sans, size: 8, color: T.tint(p.n) }],
      { tag: "mag", align: L.recto ? "Right" : "Left" });
  }

  PAGES.forEach(function (p) {
    var L = T.live(p.n);

    if (p.type === "cover" || p.type === "plate" || p.type === "photo-spread") {
      if (p.image) T.img(p.n, 0, 0, 210, 297, p.image, { tag: "mag", cover: true });
      else T.rect(p.n, 0, 0, 210, 297, { tag: "mag", fill: T.tint(p.n) });

      if (p.type === "cover") {
        T.text(p.n, L.x0, 150, L.w, 90,
          [{ t: TITLE, fam: F.disp, face: FACE.disp, size: 64, color: C.onDark }],
          { tag: "mag", lead: 62 });
      } else if (p.deck) {
        // The plate's one line: a question, low on the page, nothing else.
        T.text(p.n, L.x0, 232, T.gw(4), 24,
          [{ t: p.deck, fam: F.disp, face: FACE.dispIt, size: 20, color: C.onDark }],
          { tag: "mag", lead: 24 });
      }
      folio(p);
      return;
    }

    // A design-heavy page is one held line over one picture, in that z-order.
    if (p.type === "statement" || p.density === "D") {
      T.rect(p.n, 0, 0, 210, 297, { tag: "mag", fill: C.bone });
      if (p.image) T.img(p.n, L.x0, 150, L.w, 100, p.image, { tag: "mag", contain: true });
      T.text(p.n, L.x0, T.bl(4), L.w, 100,
        [{ t: p.deck || p.title, fam: F.disp, face: FACE.dispReg, size: 34, color: C.ink }],
        { tag: "mag", lead: 38 });
      folio(p);
      return;
    }

    // Everything else is a real editorial page: picture band, head, then two
    // columns of the six-column measure.
    //
    // The image goes down FIRST and the bands below never re-enter its area.
    // Placing it after the type put it in front, and the standfirst was being
    // painted over — visible in the first render of this spread.
    // The picture band is what the body has to live around, so density sets it:
    // a content-heavy page earns a smaller picture. A fixed 96mm band overset
    // four of the C pages in this issue.
    var IMG_H = p.density === "C" ? 58 : 92;
    var top = T.bl(0);
    if (p.image) {
      T.img(p.n, L.x0, top, T.gw(6), IMG_H, p.image, { tag: "mag", contain: true });
      top += IMG_H + 8;
    }
    if (p.title) {
      T.text(p.n, L.x0, top, T.gw(4), 20,
        [{ t: p.title, fam: F.disp, face: FACE.dispReg, size: 26, color: C.ink }],
        { tag: "mag", lead: 28 });
      top += 22;
    }
    if (p.deck) {
      T.text(p.n, L.x0, top, T.gw(5), 15,
        [{ t: p.deck, fam: F.cond, size: 12, color: C.inkSoft }], { tag: "mag", lead: 15 });
      top += 18;
    }

    var colW = T.gw(3), h = 266 - top;
    var rest = pour(p.n, L.x0, top, colW, h, String(p.body).split(/\\s+/).filter(Boolean));
    rest = pour(p.n, L.x0 + colW + T.GUT, top, colW, h, rest);
    if (rest.length) log.push("p" + p.n + ": " + rest.length + " words overset");

    folio(p);
  });

  globalThis.TK_RESULT = { pages: PAGES.length, warnings: log };
})();`;
}

/** Export the whole document. "PDF (for print)" is one of Affinity's own presets. */
const EXPORT = (pdf) => `
  const out = globalThis.TK_RESULT || {};
  const _doc = globalThis.TK_DOC;
  out.spreads = _doc.spreadCount;
  try {
    const { FileExportOptions } = require("/document");
    _doc.export(${JSON.stringify(win(pdf))}, FileExportOptions.createWithPresetName("PDF (for print)"));
    out.exported = true; out.path = ${JSON.stringify(win(pdf))};
  } catch (e) {
    out.exported = false; out.exportError = e.message;
  }
  console.log(JSON.stringify(out));`;

/**
 * Create the document, lay the issue out, export the PDF.
 *
 * Returns rather than throws when only the export fails: the pages are laid
 * out in the open document either way, and that is most of the value.
 */
export async function build(issue, { pdf, issueDir }) {
  const st = await status();
  if (!st.up) throw new Error(st.reason);

  const stage = stageAssets(issue, issueDir, st.desktop);
  // Affinity can only write to the Desktop, so export there and copy back.
  const deskPdf = join(st.desktop, "Quire", issue.id, basename(pdf));

  const script = [
    CREATE(issue.pages.length),
    `globalThis.TK_CFG = ${JSON.stringify({
      root: win(join(st.desktop, "Quire", issue.id)) + "\\",
      img: win(stage.dir) + "\\",
      sections: (issue.sections || []).map((s) => ({ n: s.n, from: s.from, to: s.to })),
    })};`,
    TK(),
    layoutScript(issue, stage.staged),
    EXPORT(deskPdf),
  ].join("\n");

  const out = await run(script, 1800000);

  if (out.exported && existsSync(deskPdf)) {
    mkdirSync(dirname(pdf), { recursive: true });
    copyFileSync(deskPdf, pdf);
  }
  return { ...out, staged: Object.keys(stage.staged).length };
}

/* ---------------------------------------------------- per-page build session
 * ComfyUI and Affinity are the two things on this machine that eat memory, so
 * neither runs a whole issue in one breath any more. A build opens the document
 * once, lays out one page per call, and closes it — and because each script is
 * a fresh JS context, every call re-finds the document and reloads the toolkit
 * rather than trusting anything to survive between them.
 */
let session = null;

/** Locate the build document again in a context that has never seen it. */
const FIND = () => `
  const { Document } = require("/document");
  const _all = Array.from(Document.all);
  const _want = ${JSON.stringify("QUIRE-BUILD")};
  // Documents are matched on a marker written into the document's own metadata
  // at creation: index and creation order both move when the user touches
  // another file mid-build.
  let _doc = null;
  for (const d of _all) { try { if (d.metadata && d.metadata.title === _want) { _doc = d; break; } } catch (e) {} }
  if (!_doc && _all.length === 1) _doc = _all[0];
  if (!_doc) throw new Error("build document not found - was it closed?");
  globalThis.TK_DOC = _doc;`;

const CREATE_TAGGED = (pages) => `
  const { Document, NewDocumentOptions, UnitType } = require("/document");
  const _o = NewDocumentOptions.createDefault();
  _o.units = UnitType.Millimetre;
  _o.width = 210; _o.height = 297; _o.dpi = 300;
  _o.pageCount = ${pages};
  _o.isFacing = true; _o.isMultiPage = true;
  const _d = Document.createFromOptions(_o);
  // The marker FIND() looks for. Without it a second open document makes the
  // build write into whichever one the SDK happens to hand back.
  try { _d.metadata.title = "QUIRE-BUILD"; } catch (e) {}
  globalThis.TK_DOC = _d;`;

function cfgFor(issue, stageDir, desktop) {
  return {
    root: win(join(desktop, "Quire", issue.id)) + "\\",
    img: win(stageDir) + "\\",
    sections: (issue.sections || []).map((s) => ({ n: s.n, from: s.from, to: s.to })),
    // The design stage's worlds, so the layout paints in the register the
    // editor approved instead of tk.js's generic colour wheel.
    worlds: (issue.design?.sections || []).map((w) => ({
      n: w.n, paper: w.paper, field: w.field, ink: w.ink, hue: w.hue,
    })),
  };
}

export async function openIssue(issue, { issueDir, pdf } = {}) {
  const st = await status();
  if (!st.up) throw new Error(st.reason);
  const stage = stageAssets(issue, issueDir, st.desktop);
  session = {
    id: issue.id, desktop: st.desktop, stage, pdf,
    cfg: cfgFor(issue, stage.dir, st.desktop),
  };
  const out = await run(CREATE_TAGGED(issue.pages.length) + `\nconsole.log(JSON.stringify({ok:true}));`, 300000);
  if (out.raw) throw new Error("could not create the build document: " + out.raw.slice(0, 200));
  return { ok: true, staged: Object.keys(stage.staged).length };
}

export async function closeIssue({ pdf } = {}) {
  if (!session) return { ok: true, nothing: true };
  const target = pdf || session.pdf;
  let out = { ok: true };
  if (target) {
    const deskPdf = join(session.desktop, "Quire", session.id, basename(target));
    out = await run(FIND() + "\n" + EXPORT(deskPdf), 900000);
    if (out.exported && existsSync(deskPdf)) {
      mkdirSync(dirname(target), { recursive: true });
      copyFileSync(deskPdf, target);
      out.path = target;
    }
  }
  session = null;
  return out;
}

/**
 * Lay out one page and inspect it. Returns the page's findings so the queue can
 * record them per page rather than as one undifferentiated warning list.
 */
export async function buildPage(issue, page) {
  if (!session) throw new Error("no build session - openIssue first");
  const world = (issue.design?.sections || []).find((w) => {
    const sec = (issue.sections || []).find((s) => page.n >= s.from && page.n <= s.to);
    return w.n === sec?.n;
  }) || null;

  const script = [
    FIND(),
    `globalThis.TK_CFG = ${JSON.stringify(session.cfg)};`,
    TK(),
    onePageScript(issue, page, world, session.stage.staged),
    INSPECT(page.n),
  ].join("\n");
  return run(script, 600000);
}

/** One page's layout. The shared helpers are restated because each script is
 *  a fresh context — there is nowhere to keep them between calls. */
function onePageScript(issue, page, world, staged) {
  const p = {
    n: page.n, type: page.type, density: page.density, section: page.section,
    title: page.title || "", deck: page.deck || "", body: page.body || "",
    pull: page.pullQuote || "", furniture: (page.furniture || []).slice(0, 4),
    image: staged[String(page.n).padStart(2, "0") + ".png"] || null,
  };

  return `(function () {
  const T = globalThis.TK;
  if (!T) throw new Error("toolkit not loaded");
  const P = ${JSON.stringify(p)};
  const W = ${JSON.stringify(world)};
  const TITLE = ${JSON.stringify(issue.title || issue.subject)};
  const C = T.C, F = T.F, FACE = T.FACE;
  const log = [];

  // The section's own palette, falling back to the toolkit's neutrals when the
  // design stage has not run. Paper is the default ground; the saturated field
  // is asked for by name, which is what stops a section becoming a wash.
  const PAPER = (W && W.paper) || C.bone;
  const INK   = (W && W.ink)   || C.ink;
  const FIELD = (W && W.field) || T.tint(P.n);

  // Re-laying a page must replace it, not stack on top of the last attempt.
  T.kill("mag-p" + P.n, [P.n]);
  const TAG = "mag-p" + P.n;

  function pour(x, y, w, h, words, style) {
    if (!words.length) return [];
    var lo = 1, hi = words.length, best = 0;
    while (lo <= hi) {
      var mid = (lo + hi) >> 1;
      var n = T.text(P.n, x, y, w, h, [{ t: words.slice(0, mid).join(" ") }],
        Object.assign({ tag: "mag-probe", align: "Justify", hyph: true }, style || {}));
      if (T.overflows(n)) hi = mid - 1; else { best = mid; lo = mid + 1; }
    }
    T.kill("mag-probe", [P.n]);
    if (!best) { log.push("no room for body"); return words; }
    T.text(P.n, x, y, w, h, [{ t: words.slice(0, best).join(" ") }],
      Object.assign({ tag: TAG, align: "Justify", hyph: true, color: INK }, style || {}));
    return words.slice(best);
  }

  function folio() {
    if (P.n === 1 || P.type === "plate") return;   // a plate carries no folio
    var L = T.live(P.n);
    T.text(P.n, L.recto ? L.x1 - 20 : L.x0, 277, 20, 6,
      [{ t: String(P.n), fam: F.sans, size: 8, color: FIELD }],
      { tag: TAG, align: L.recto ? "Right" : "Left" });
  }

  var L = T.live(P.n);

  if (P.type === "cover" || P.type === "plate" || P.type === "photo-spread") {
    if (P.image) T.img(P.n, 0, 0, 210, 297, P.image, { tag: TAG, cover: true });
    else T.rect(P.n, 0, 0, 210, 297, { tag: TAG, fill: FIELD });
    if (P.type === "cover") {
      T.text(P.n, L.x0, 150, L.w, 90,
        [{ t: TITLE, fam: F.disp, face: FACE.disp, size: 64, color: C.onDark }],
        { tag: TAG, lead: 62 });
    } else if (P.deck) {
      T.text(P.n, L.x0, 232, T.gw(4), 24,
        [{ t: P.deck, fam: F.disp, face: FACE.dispIt, size: 20, color: C.onDark }],
        { tag: TAG, lead: 24 });
    }
    folio();
  } else if (P.type === "statement" || P.density === "D") {
    T.rect(P.n, 0, 0, 210, 297, { tag: TAG, fill: PAPER });
    if (P.image) T.img(P.n, L.x0, 150, L.w, 100, P.image, { tag: TAG, contain: true });
    T.text(P.n, L.x0, T.bl(4), L.w, 100,
      [{ t: P.deck || P.title, fam: F.disp, face: FACE.dispReg, size: 34, color: INK }],
      { tag: TAG, lead: 38 });
    folio();
  } else {
    T.rect(P.n, 0, 0, 210, 297, { tag: TAG, fill: PAPER });
    // Image first: it is placed behind, and the bands below never re-enter it.
    // A content-heavy page earns a smaller picture, or the body oversets.
    var IMG_H = P.density === "C" ? 58 : 92;
    var top = T.bl(0);
    if (P.image) {
      T.img(P.n, L.x0, top, T.gw(6), IMG_H, P.image, { tag: TAG, contain: true });
      top += IMG_H + 8;
    }
    if (P.title) {
      T.text(P.n, L.x0, top, T.gw(4), 20,
        [{ t: P.title, fam: F.disp, face: FACE.dispReg, size: 26, color: INK }],
        { tag: TAG, lead: 28 });
      top += 22;
    }
    if (P.deck) {
      T.text(P.n, L.x0, top, T.gw(5), 15,
        [{ t: P.deck, fam: F.cond, size: 12, color: INK }], { tag: TAG, lead: 15 });
      top += 18;
    }
    var colW = T.gw(3), h = 266 - top;
    var rest = pour(L.x0, top, colW, h, String(P.body).split(/\s+/).filter(Boolean));
    rest = pour(L.x0 + colW + T.GUT, top, colW, h, rest);
    if (rest.length) log.push(rest.length + " words overset");
    folio();
  }

  globalThis.TK_RESULT = { page: P.n, warnings: log };
})();`;
}

/**
 * The per-page design check.
 *
 * Every measurement here is one a person would make with a ruler on a proof:
 * is anything hanging off the trim, is type inside the margins, do two frames
 * sit on top of each other, is the picture sharp enough to print, is the type
 * big enough to read. A rendered thumbnail comes back with it so the page can
 * be looked at as well as measured — the overlap defect that got through the
 * first build was invisible to every check and obvious in a render.
 */
const INSPECT = (n) => `(function () {
  const T = globalThis.TK;
  const R = globalThis.TK_RESULT || { page: ${n}, warnings: [] };
  const g = T.pg(${n}), L = T.live(${n}), MM = T.MM;
  const FULL = ${JSON.stringify(["cover", "plate", "photo-spread"])};
  const findings = [];

  // Page-space box, in mm, for a node on this spread.
  function box(node) {
    const b = node.getSpreadBaseBox(false);
    const k = 25.4 / T.DPI;
    return { x: b.x * k - g.ox, y: b.y * k, w: b.width * k, h: b.height * k };
  }
  function overlap(a, b) {
    const ox = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
    const oy = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
    return ox > 1 && oy > 1 ? ox * oy : 0;      // 1mm of touching is not a clash
  }

  const nodes = T.SPREADS[g.si].layers.toArray()
    .filter(function (x) { var d = x.userDescription; return d && d.indexOf("mag-p${n}") === 0; });

  if (!nodes.length) findings.push({ level: "error", what: "page is empty" });

  const texts = [];
  nodes.forEach(function (node) {
    var b;
    try { b = box(node); } catch (e) { return; }
    // Only count what is actually on this page of the spread.
    if (b.x + b.w < -2 || b.x > 212) return;

    var isText = false;
    try { isText = !!node.lineBox; } catch (e) {}

    if (isText) {
      texts.push({ node: node, b: b });
      if (T.overflows(node)) findings.push({ level: "error", what: "text frame oversets", at: Math.round(b.y) });
      // Type outside the live area is a margin violation on every page that is
      // not deliberately full-bleed.
      if (b.x < L.x0 - 1 || b.x + b.w > L.x1 + 1 || b.y < 8 || b.y + b.h > 289) {
        findings.push({ level: "warn", what: "type outside the live area", at: Math.round(b.y) });
      }
    } else if (b.x < -1 || b.y < -1 || b.x + b.w > 211 || b.y + b.h > 298) {
      // A picture may bleed; a rule or a panel hanging off the trim is a slip.
      findings.push({ level: "info", what: "element crosses the trim", at: Math.round(b.y) });
    }
  });

  for (var i = 0; i < texts.length; i++) {
    for (var j = i + 1; j < texts.length; j++) {
      var a = overlap(texts[i].b, texts[j].b);
      if (a > 40) findings.push({ level: "error", what: "two text frames overlap", area: Math.round(a) });
    }
  }

  R.findings = findings;
  R.errors = findings.filter(function (f) { return f.level === "error"; }).length;
  R.nodes = nodes.length;
  console.log(JSON.stringify(R));
})();`;
