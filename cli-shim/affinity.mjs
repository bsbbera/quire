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
import * as events from "./events.mjs";
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { colourGrain } from "./postprocess.mjs";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import * as mcp from "./mcp.mjs";
import { BENGALI, brandDir, shapeBengali } from "./bengali.mjs";
import { shapeTexts } from "./spread.mjs";
import { makeTiles } from "./brand-tiles.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
// Read per build, not once at import: editing the toolkit should not need a
// restart of the shim to take effect.
const TK = () => readFileSync(join(HERE, "affinity", "tk.js"), "utf8");

const win = (p) => String(p).replace(/\//g, "\\");

// The Affinity MCP refuses every call until its preamble has been read once
// per session — including execute_script, which fails with a message about
// documentation rather than anything script-shaped. Any restart of the shim
// starts a new session, so this is checked rather than assumed.
/**
 * Bring Affinity up.
 *
 * The connector used to assume the application was already running with its
 * MCP server switched on, and reported "unknown MCP server: affinity" when it
 * was not — an error about Quire's own config for a condition Quire can fix.
 * Affinity ships as an MSIX package, so it is launched through the apps folder
 * rather than a path, and the wait is on its SSE port rather than on the
 * process: the window opens well before the server behind it answers.
 */
const AFFINITY_APP = "Canva.Affinity_8a0j1tnjnt4a4!Canva.Affinity";
const AFFINITY_SSE = process.env.AFFINITY_SSE_URL || "http://localhost:6767/sse";

async function ssePort(ms = 2000) {
  const c = new AbortController();
  const t = setTimeout(() => c.abort(), ms);
  try {
    // The endpoint streams and never completes, so arriving at the response
    // headers is the whole test; the body is left unread. A timeout counts as
    // down, not up — reading it the other way reported a filtered port as a
    // working server and sent the connector on to fail further along.
    const res = await fetch(AFFINITY_SSE, { signal: c.signal });
    try { await res.body?.cancel(); } catch { /* already gone */ }
    return true;
  } catch { return false; } finally { clearTimeout(t); }
}

/**
 * The rule: Quire never opens Affinity on its own.
 *
 * Only a build the user asked for may start it, and it says so by passing
 * `launch`. Everything else — status probes, doctor checks, closing a document,
 * whatever gets written next — finds a closed port and reports it. The default
 * is refusal rather than a launch, so a caller that forgets cannot open a
 * licensed application on somebody's desktop by accident. The dashboard did
 * exactly that on every single app start.
 */
let launching = null;
export async function ensureRunning({ timeoutMs = 120000, launch = false } = {}) {
  if (await ssePort()) return { started: false };
  if (!launch) {
    throw new Error(
      "Affinity is not running, and Quire does not start it on its own. "
      + "Open Affinity (and switch on Settings > MCP Server), or start a build from the app.",
    );
  }
  // Two builds racing to launch the same application gets two windows and a
  // dialog, so a launch already in flight is joined rather than repeated.
  if (launching) return launching;
  launching = (async () => {
    try {
      spawn("explorer.exe", ["shell:AppsFolder\\" + AFFINITY_APP], {
        detached: true, stdio: "ignore", windowsHide: true,
      }).unref();
    } catch (e) {
      throw new Error(`could not launch Affinity: ${e.message}`);
    }
    const until = Date.now() + timeoutMs;
    while (Date.now() < until) {
      await new Promise((r) => setTimeout(r, 2000));
      if (await ssePort()) return { started: true };
    }
    throw new Error(
      "Affinity was launched but its MCP server did not answer on "
      + `${AFFINITY_SSE} within ${Math.round(timeoutMs / 1000)}s. `
      + "Switch it on in Affinity: Settings > MCP Server.",
    );
  })();
  try { return await launching; } finally { launching = null; }
}

let preambleRead = false;
async function ensurePreamble() {
  if (preambleRead) return;
  await mcp.call("affinity", "read_sdk_documentation_topic", { filename: "preamble" }, 60000);
  preambleRead = true;
}

/**
 * Run one script in Affinity and parse the JSON its console.log prints.
 *
 * `launch` travels from the operation, not from here: only the ones a person
 * starts on purpose may open the application. See `ensureRunning`.
 */
async function run(script, ms = 300000, { launch = false } = {}) {
  await ensureRunning({ launch });
  await ensurePreamble();
  // A reconnected MCP session forgets the preamble; it says so as text or as a thrown error.
  const PREAMBLE = /preamble documentation topic has not yet been read/i;
  const once = () => mcp.call("affinity", "execute_script", { script }, ms)
    .catch((e) => { if (PREAMBLE.test(String(e?.message))) return { text: e.message }; throw e; });
  let r = await once();
  if (PREAMBLE.test(String(r.text))) {
    preambleRead = false;
    await ensurePreamble();
    r = await once();
  }
  const text = String(r.text || "").trim();
  const m = /\{[\s\S]*\}$/.exec(text);
  if (!m) return { raw: text };
  try { return JSON.parse(m[0]); } catch { return { raw: text }; }
}

/**
 * The brand's faces, seen by Affinity before anything is set in them. Per-user fonts drop out of
 * Affinity across restarts ("missing font family" on every block); announcing them again with
 * AddFontResourceW + WM_FONTCHANGE brings them back after a delay, no admin and no restart.
 */
async function ensureBrandFonts(issue) {
  const dir = issue?.brand && brandDir(issue.brand);
  if (!dir) return;
  const type = JSON.parse(readFileSync(join(dir, "brand.json"), "utf-8")).type ?? {};
  const want = [...new Set([type.mark, type.display, type.text].filter(Boolean))];
  const seen = async () => {
    const out = await run(`(function () { const { FontFamily } = require("/fonts");
  console.log(JSON.stringify({ names: FontFamily.all.map(function (f) { return f.name; }) })); })();`, 60000);
    return want.filter((f) => !(out.names ?? []).includes(f));
  };
  let missing = await seen();
  if (!missing.length) return;
  const userFonts = join(process.env.LOCALAPPDATA ?? "", "Microsoft", "Windows", "Fonts");
  const files = Object.values(type.files ?? {}).map((f) => join(userFonts, f)).filter(existsSync);
  if (!files.length) throw new Error(`Affinity is missing the brand's fonts (${missing.join(", ")}) and they are not installed`);
  await new Promise((done) => spawn("powershell", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", join(HERE, "affinity", "fontchange.ps1"), ...files], { stdio: "ignore" }).on("close", done));
  for (let i = 0; i < 40 && missing.length; i++) {
    await new Promise((r) => setTimeout(r, 15000));
    missing = await seen();
  }
  fontList = null;
  if (missing.length) throw new Error(`Affinity still cannot see the brand's fonts after 10 minutes: ${missing.join(", ")}`);
}

/**
 * The font families Affinity can set, for the design stage to choose from
 * (font preflight, Phase 5). Read once per shim run; never launches Affinity.
 */
let fontList = null;
export async function fonts() {
  if (fontList) return { fonts: fontList };
  if (!(await ssePort())) return { fonts: [], reason: "Affinity is not running" };
  const out = await run(`(function () {
  const { FontFamily } = require("/fonts");
  console.log(JSON.stringify({ fonts: [...new Set(FontFamily.all.map(function (f) { return f.name; }))].sort() }));
})();`, 60000);
  if (Array.isArray(out.fonts) && out.fonts.length) fontList = out.fonts;
  return { fonts: fontList || [] };
}

/**
 * What Affinity is doing, without making it do anything.
 *
 * Asking used to answer by launching: `run` calls `ensureRunning`, so the
 * dashboard's status probe started Affinity every time Quire opened. A status
 * check must never have a side effect that large, so a closed port is
 * reported rather than opened. Pass `launch` where starting it is the point.
 */
export async function status({ launch = false } = {}) {
  if (!launch && !(await ssePort())) {
    return {
      up: false,
      reason: "Affinity is not running, or its MCP server is off (Settings > MCP Server)",
    };
  }
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
      console.log(JSON.stringify(o));`, 30000, { launch });
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
  // Each page's own picture — the one chosen in the gallery, else the first
  // rendered — from where the art stage writes it. Only `_assets/` was ever
  // staged and nothing writes there now, so a generated issue was built with
  // every picture frame empty.
  for (const p of issue.pages || []) {
    const file = p.image || (p.images || []).find(Boolean);
    if (!file || !/\.png$/i.test(file)) continue;
    const from = existsSync(file) ? file : join(issueDir, file);
    if (!existsSync(from)) continue;
    const name = String(p.n).padStart(2, "0") + ".png";
    copyFileSync(from, join(dest, name));
    staged[name] = win(join(dest, name));
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
 * The Map's data, from the issue's web and its flatplan (13 rev. A).
 *
 * Each ring of the web with the pages that look through it, and every pair of
 * rings a page's bridge ties together. Drawn by tk.js `webMap`; computed here
 * because the layout script has no way to read the issue but what it is handed.
 */
/**
 * A body as a flat run of words, each knowing its paragraph (`g`) and whether
 * that paragraph is a heading (`k: "h"`). The copy is markdown; Affinity set
 * the `###` as text because nothing here ever read it.
 */
export function bodyItems(body) {
  const items = [];
  const plain = String(body || "")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")            // [text](url) -> text
    .replace(/\*\*|__|`/g, "")
    .replace(/(^|[\s(])[*_]([^*_\n]+)[*_](?=[\s.,;:!?)]|$)/g, "$1$2")  // *em* / _em_
    .replace(/^[ \t]*(?:>|[-*+]|\d+[.)])[ \t]+/gm, "");  // quote and list markers
  plain.split(/\n\s*\n|\n(?=#)/).forEach((block) => {
    const text = block.trim();
    if (!text) return;
    const h = /^#{1,6}\s+(.*)$/s.exec(text);
    const g = items.length ? items[items.length - 1].g + 1 : 0;
    (h ? h[1] : text).split(/\s+/).filter(Boolean).forEach((t) => items.push({ t, g, k: h ? "h" : "p" }));
  });
  return items;
}

/** Markup that would print as characters: what reached the page, not what was written. */
export function leaksOf(texts) {
  const out = new Set();
  for (const t of texts) {
    const m = String(t || "").match(/#{1,6}(?=\s|$)|\*\*|__|`|\[[^\]]*\]\(|^>\s/gm);
    if (m) m.forEach((x) => out.add(x.trim()));
  }
  return [...out];
}

export function mapData(issue) {
  const pages = issue.pages || [];
  const key = (s) => String(s || "").trim().toLowerCase();
  const names = issue.web?.rings?.length
    ? issue.web.rings
    : [...new Set(pages.map((p) => p.ring).filter(Boolean))];
  const index = new Map(names.map((name, i) => [key(name), i]));
  const rings = names.map((name) => ({
    name,
    pages: pages.filter((p) => key(p.ring) === key(name) && p.type !== "map").map((p) => p.n),
  }));
  const ringOf = new Map(pages.map((p) => [p.n, index.get(key(p.ring))]));
  const seen = new Set();
  const pairs = [];
  for (const p of pages) {
    for (const l of p.links || []) {
      const a = ringOf.get(p.n), b = ringOf.get(l.to);
      if (a === undefined || b === undefined || a === b) continue;
      const pair = a < b ? [a, b] : [b, a];
      if (!seen.has(pair.join("-"))) { seen.add(pair.join("-")); pairs.push(pair); }
    }
  }
  return {
    centre: issue.web?.centre || issue.title || issue.subject || "",
    rings,
    pairs,
    accent: issue.design?.spec?.palette?.accent || issue.web?.accent?.hex || null,
  };
}

/** The page a page is tied to, for the note beside its folio. */
const linkOf = (p) => (p.links || []).map((l) => Number(l.to)).find((n) => n && n !== p.n) || null;

/**
 * The layout, as one script. Runs after tk.js has defined globalThis.TK.
 *
 * Archetypes come from EDITORIAL-METHOD section 4: having them is the whole
 * point, because "big picture + big word" on every spread is the exact failure
 * the method was written to fix.
 */
export function layoutScript(issue, staged) {
  const pages = issue.pages.map((p) => ({
    n: p.n, type: p.type, density: p.density, section: p.section,
    title: p.title || "", deck: p.deck || "", items: bodyItems(p.body),
    pull: p.pullQuote || "", furniture: (p.furniture || []).slice(0, 4),
    image: staged[String(p.n).padStart(2, "0") + ".png"] || null,
    treatment: (p.briefs && p.briefs[0] && p.briefs[0].treatment) || null,
    link: linkOf(p),
  }));

  return `(function () {
  const T = globalThis.TK;
  if (!T) throw new Error("toolkit not loaded");
  const PAGES = ${JSON.stringify(pages)};
  const MAP = ${JSON.stringify(mapData(issue))};
  const TITLE = ${JSON.stringify(issue.title || issue.subject)};
  const C = T.C, F = T.F, FACE = T.FACE;
  const log = [];

  var CTX = { pn: 0, tag: "mag", ink: C.ink };
  ${FLOW_JS}

  function folio(p) {
    if (p.n === 1 || p.type === "plate") return;   // a plate carries no folio
    var L = T.live(p.n);
    T.text(p.n, L.recto ? L.x1 - 20 : L.x0, 277, 20, 6,
      [{ t: String(p.n), fam: F.sans, size: 8, color: T.tint(p.n) }],
      { tag: "mag", align: L.recto ? "Right" : "Left" });
    // The page it is tied to, in the accent: the brand's connection line.
    if (p.link) T.linkNote(p.n, p.link, { tag: "mag" });
  }

  PAGES.forEach(function (p) {
    CTX.pn = p.n;
    var L = T.live(p.n);

    // The Map: the whole web on a spread, drawn once from its left-hand page.
    if (p.type === "map") {
      var prev = PAGES.find(function (q) { return q.n === p.n - 1; });
      var next = PAGES.find(function (q) { return q.n === p.n + 1; });
      if (p.n % 2 === 1 && prev && prev.type === "map") { folio(p); return; }
      var spread = p.n % 2 === 0 && next && next.type === "map";
      T.rect(p.n, 0, 0, spread ? 420 : 210, 297, { tag: "mag", fill: C.bone });
      if (p.title) T.text(p.n, L.x0, T.bl(0), T.gw(4), 20,
        [{ t: p.title, fam: F.disp, face: FACE.dispReg, size: 26, color: C.ink }], { tag: "mag", lead: 28 });
      if (p.deck) T.text(p.n, L.x0, T.bl(0) + 22, T.gw(4), 15,
        [{ t: p.deck, fam: F.cond, size: 12, color: C.inkSoft }], { tag: "mag", lead: 15 });
      pour(L.x0, T.bl(0) + 40, T.gw(3), 30, p.items);
      T.webMap(p.n, MAP, { tag: "mag", spread: !!spread });
      folio(p);
      return;
    }

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
    // Cutout: outer edge, stepped columns (see the per-page builder).
    var cut = p.image && p.treatment === "cutout"
      ? T.cutout(p.n, top, T.gw(2), IMG_H + 24, p.image, { tag: "mag" }) : null;
    var headX = cut && !L.recto ? L.x0 + T.gw(2) + T.GUT : L.x0;
    if (p.image && !cut) {
      T.img(p.n, L.x0, top, T.gw(6), IMG_H, p.image, { tag: "mag", contain: true });
      top += IMG_H + 8;
    }
    if (p.title) {
      T.text(p.n, headX, top, T.gw(4), 20,
        [{ t: p.title, fam: F.disp, face: FACE.dispReg, size: 26, color: C.ink }],
        { tag: "mag", lead: 28 });
      top += 22;
    }
    if (p.deck) {
      T.text(p.n, headX, top, cut ? T.gw(4) : T.gw(5), 15,
        [{ t: p.deck, fam: F.cond, size: 12, color: C.inkSoft }], { tag: "mag", lead: 15 });
      top += 18;
    }

    var colW = T.gw(3);
    var below = cut ? Math.max(top, cut.y + cut.h + 6) : top;
    var leftTop = cut && !L.recto ? below : top, rightTop = cut && L.recto ? below : top;
    pourBalanced([L.x0, L.x0 + colW + T.GUT], [leftTop, rightTop], colW, 266, p.items);

    folio(p);
  });

  globalThis.TK_RESULT = { pages: PAGES.length, warnings: log };
})();`;
}

/** Export the whole document. "PDF (for print)" is one of Affinity's own presets. */
const EXPORT = (pdf) => `
  const out = globalThis.TK_RESULT || {};
  // Not _doc: FIND() declares that, and closeIssue sends the two as one script.
  const _xdoc = globalThis.TK_DOC;
  out.spreads = _xdoc.spreadCount;
  try {
    const { FileExportOptions } = require("/document");
    _xdoc.export(${JSON.stringify(win(pdf))}, FileExportOptions.createWithPresetName("PDF (for print)"));
    out.exported = true; out.path = ${JSON.stringify(win(pdf))};
  } catch (e) {
    out.exported = false; out.exportError = e.message;
  }
  console.log(JSON.stringify(out));`;

/**
 * The whole issue, laid out the way the design stage composed it: one page at
 * a time through buildPage, which reads each page's designed blocks. The old
 * single-script layout (layoutScript) knows only page types, so it dropped
 * every panel, pull, kicker and drawn shape the design had placed.
 */
export async function build(issue, { pdf, issueDir }) {
  const st = await status();
  if (!st.up) throw new Error(st.reason);
  events.emit("affinity:build:start", { issue: issue.id, pages: issue.pages.length });
  // A fresh document every build: a reused session would lay pages over the last one.
  session = null;
  const opened = await openIssue(issue, { issueDir, pdf, fresh: true });
  const pages = [];
  for (const page of issue.pages) {
    const out = await buildPage(issue, page);
    if (out.raw && !out.ok) throw new Error(`page ${page.n} did not lay out: ${String(out.raw).slice(0, 300)}`);
    // What Affinity measured on the laid page; the runner decides what blocks the build.
    pages.push({ n: page.n, findings: out.findings || [], leaks: out.leaks || [] });
  }
  const closed = await closeIssue({ pdf });
  // The pages stay laid out in the open document either way, but a build that
  // wrote no PDF is not done: an old PDF on disk would otherwise pass for this one.
  if (!closed.exported) throw new Error(`the pages are laid out but the PDF did not export: ${closed.exportError || String(closed.raw || "no answer").slice(0, 300)}`);
  events.emit("affinity:build:done", { issue: issue.id, pdf: existsSync(pdf) ? pdf : null });
  return { ...closed, pages, staged: opened.staged };
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
const FIND = (uuid) => `
  const { Document } = require("/document");
  const _all = Array.from(Document.all);
  const _want = ${JSON.stringify("QUIRE-BUILD")};
  // Documents are matched on a marker written into the document's own metadata
  // at creation: index and creation order both move when the user touches
  // another file mid-build.
  let _doc = null;
  // The session uuid is what holds across documents: \`metadata\` is not there on 3.3.
  for (const d of _all) { try { if (${JSON.stringify(uuid || "")} && d.sessionUuid === ${JSON.stringify(uuid || "")}) { _doc = d; break; } } catch (e) {} }
  if (!_doc) for (const d of _all) { try { if (d.metadata && d.metadata.title === _want) { _doc = d; break; } } catch (e) {} }
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
  globalThis.TK_DOC = _d;
  console.log(JSON.stringify({ uuid: _d.sessionUuid }));`;

function cfgFor(issue, stageDir, desktop) {
  return {
    root: win(join(desktop, "Quire", issue.id)) + "\\",
    img: win(stageDir) + "\\",
    sections: (issue.sections || []).map((s) => ({ n: s.n, from: s.from, to: s.to })),
    // The design decision, when one has been made. tk.js takes its
    // palette, faces and grid from here and falls back to its own
    // defaults per atom, so a spec naming a font this machine does
    // not have loses that font, not the build.
    spec: (issue.design && issue.design.spec) || null,
    // The design stage's worlds, so the layout paints in the register the
    // editor approved instead of tk.js's generic colour wheel.
    worlds: (issue.design?.sections || []).map((w) => ({
      n: w.n, paper: w.paper, field: w.field, ink: w.ink, hue: w.hue,
    })),
  };
}

export async function openIssue(issue, { issueDir, pdf, fresh = false } = {}) {
  const st = await status();
  if (!st.up) throw new Error(st.reason);
  await ensureBrandFonts(issue);
  // A page build opens each time; one document per issue, not one per page.
  if (session && session.id === issue.id && session.uuid) {
    return { ok: true, staged: Object.keys(session.stage.staged).length, reused: true };
  }
  const stage = stageAssets(issue, issueDir, st.desktop);
  session = {
    id: issue.id, desktop: st.desktop, stage, pdf,
    cfg: cfgFor(issue, stage.dir, st.desktop),
  };
  // Affinity's scripting cannot close a document (doc.close() is NOT_IMPLEMENTED), so every new
  // one stays open as "Untitled" until the user closes it. The issue's document is remembered on
  // disk and found again by its session id: a second run, or a restarted shim, reuses it.
  const mark = join(st.desktop, "Quire", issue.id, "document.json");
  if (!fresh) {
    try {
      const { uuid, pages } = JSON.parse(readFileSync(mark, "utf-8"));
      if (uuid && pages === issue.pages.length) {
        const seen = await run(`const { Document } = require("/document"); console.log(JSON.stringify({ open: Array.from(Document.all).some((d) => d.sessionUuid === ${JSON.stringify(uuid)}) }));`, 60000, { launch: true });
        if (seen.open) { session.uuid = uuid; return { ok: true, staged: Object.keys(stage.staged).length, reused: true }; }
      }
    } catch { /* none remembered */ }
  }
  const out = await run(CREATE_TAGGED(issue.pages.length), 300000, { launch: true });
  if (out.raw || !out.uuid) throw new Error("could not create the build document: " + (out.raw || "no session id").slice(0, 200));
  session.uuid = out.uuid;
  mkdirSync(dirname(mark), { recursive: true });
  writeFileSync(mark, JSON.stringify({ uuid: out.uuid, pages: issue.pages.length }));
  return { ok: true, staged: Object.keys(stage.staged).length };
}

export async function closeIssue({ pdf } = {}) {
  if (!session) return { ok: true, nothing: true };
  const target = pdf || session.pdf;
  let out = { ok: true };
  if (target) {
    const deskPdf = join(session.desktop, "Quire", session.id, basename(target));
    out = await run(FIND(session.uuid) + "\n" + EXPORT(deskPdf), 900000);
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
 * Export one spread as a PNG, so the model can look at what it laid out.
 *
 * Everything else here is write-only: a script places objects and reports
 * findings in text, which tells a model whether its instructions were followed
 * and nothing about whether the result is any good. A page can satisfy every
 * rule the inspector checks and still be ugly.
 *
 * Verified on Affinity 3.3 (ARCHITECTURE.md "The page score"). A rejected
 * export comes back as renderError rather than a thrown script, so a render
 * failure degrades to "no image" instead of taking the build down with it.
 */
export async function renderPage(issue, page, out) {
  if (!session) throw new Error("no build session - openIssue first");
  const target = out || join(session.desktop, "Quire", session.id, `spread-${page}.png`);
  // Affinity does not overwrite: with the old file there, the new render went
  // to name_1.png and the stale one was returned and scored. Clear both first.
  const base = basename(target, ".png");
  if (existsSync(dirname(target))) {
    for (const f of readdirSync(dirname(target))) {
      if (f === base + ".png" || (f.startsWith(base + "_") && f.endsWith(".png"))) unlinkSync(join(dirname(target), f));
    }
  }
  const script = [
    FIND(session.uuid),
    `globalThis.TK_CFG = ${JSON.stringify(session.cfg)};`,
    `(function () {
  const out = globalThis.TK_RESULT || {};
  const _doc = globalThis.TK_DOC;
  try {
    const { FileExportOptions, FileExportArea } = require("/document");
    const opts = FileExportOptions.createWithPresetName("PNG");
    // Without an area the export writes every spread, numbered; ask for one. 150 dpi: the eye
    // needs no more, and 300-dpi pages (10 MB each) kept the designer past its time limit.
    _doc.export(${JSON.stringify(win(target))}, opts, FileExportArea.createForSpreads(${JSON.stringify(String(Number(page)))}), { width: 1240, height: 1754 });
    out.rendered = true; out.path = ${JSON.stringify(win(target))};
  } catch (e) {
    out.rendered = false; out.renderError = e.message;
  }
  console.log(JSON.stringify(out));
})();`,
  ].join("\n");
  const res = await run(script, 300000, { launch: true });
  // Affinity may number the file (name_1.png) even for a single spread.
  if (res.rendered && !existsSync(target)) {
    const made = readdirSync(dirname(target)).filter((f) => f.startsWith(base + "_") && f.endsWith(".png"));
    if (made.length === 1) renameSync(join(dirname(target), made[0]), target);
  }
  if (res.rendered && existsSync(target)) return { ok: true, image: target };
  return { ok: false, error: res.renderError || "Affinity did not write the image" };
}

/**
 * Lay out one page and inspect it. Returns the page's findings so the queue can
 * record them per page rather than as one undifferentiated warning list.
 */
/**
 * A page's section world (core publication-runner.ts `worldFor`). Front matter
 * wears the first section's world and back matter the last's: a cover with no
 * world fell back to the toolkit's tint and came out grey.
 */
export function worldOf(issue, n) {
  const worlds = [...(issue.design?.sections || [])].sort((a, b) => a.n - b.n);
  const sec = (issue.sections || []).find((s) => n >= s.from && n <= s.to);
  if (sec) return worlds.find((w) => w.n === sec.n) || null;
  if (!worlds.length) return null;
  const first = Math.min(...(issue.sections || []).map((s) => s.from));
  return n < first ? worlds[0] : worlds[worlds.length - 1];
}

export async function buildPage(issue, page) {
  if (!session) throw new Error("no build session - openIssue first");
  const world = worldOf(issue, page.n);
  const brand = brandOf(issue);
  const bn = brand ? await shapeBengali(brand.id, bengaliItems(issue, page, world, brand)) : {};

  const script = [
    FIND(session.uuid),
    `globalThis.TK_CFG = ${JSON.stringify(session.cfg)};`,
    // The brand's shape kit before the toolkit: it defines G and ochinShape, which tk.js draws brand shapes with.
    brand ? brand.kit : "",
    TK(),
    onePageScript(issue, page, world, session.stage.staged, brand ? { id: brand.id, name: brand.name, bn } : null),
    INSPECT(page.n),
  ].join("\n");
  events.emit("affinity:page:start", { issue: issue.id, page: page.n });
  const out = await run(script, 600000);
  events.emit("affinity:page:done", { issue: issue.id, page: page.n });
  // Checked on what was handed to Affinity, after bodyItems: anything here prints.
  out.leaks = leaksOf([page.title, page.deck, bodyItems(page.body).map((i) => i.t).join(" ")]);
  return out;
}

/**
 * One authored spread (core spread-author.ts): a designer's script, written against the brand's
 * kit (brands/<id>/author/lib.js), run on the open build document. The script owns its pages: it
 * clears them and draws everything. Its text blocks are shaped first (spread.mjs). Nothing it
 * prints reaches the caller but the report: what it placed, where, and whether it threw.
 */
export async function runSpread(issue, { pages, script, texts, issueDir }) {
  if (!session) throw new Error("no build session - openIssue first");
  const brand = brandOf(issue);
  if (!brand) throw new Error("an authored spread needs the issue's brand");
  const dir = brandDir(issue.brand);
  const lib = readFileSync(join(dir, "author", "lib.js"), "utf-8");
  // pictures found since the document was opened are staged now
  const src = join(issueDir || "", "_assets");
  if (issueDir && existsSync(src)) {
    for (const f of readdirSync(src).filter((f) => /\.(png|jpe?g)$/i.test(f))) {
      if (!session.stage.staged[f]) { copyFileSync(join(src, f), join(session.stage.dir, f)); session.stage.staged[f] = win(join(session.stage.dir, f)); }
    }
  }
  const tiles = join(session.desktop, "Quire", "_tiles");
  makeTiles(tiles, Object.values(brand.colours || {}).map((c) => c.hex || c).filter((h) => /^#[0-9a-f]{6}$/i.test(h)));
  const shaped = await shapeTexts(issue.brand, texts);
  if (shaped.errors.length) return { ok: false, error: "text: " + shaped.errors.join("; ") };
  const OCHIN = { texts: shaped.blocks, img: win(session.stage.dir) + "\\", tiles: win(tiles) + "\\", title: issue.title || issue.subject || "" };
  const body = [
    FIND(session.uuid),
    `globalThis.TK_CFG = ${JSON.stringify(session.cfg)};`,
    brand.kit,
    TK(),
    lib,
    `globalThis.OCHIN = ${JSON.stringify(OCHIN)};`,
    `(function () {
  const _log = console.log, said = [];
  console.log = (...a) => said.push(a.map(String).join(" ").slice(0, 300));
  let error = null;
  try { (new Function(${JSON.stringify(String(script))}))(); }
  catch (e) { error = { message: String(e && e.message || e), stack: String(e && e.stack || "").split(String.fromCharCode(10)).slice(0, 4).join(" | ") }; }
  console.log = _log;
  const P = globalThis.OCHIN_PLACED || { text: [], photo: [], cleared: [] };
  _log(JSON.stringify({ ok: !error, error, placed: P, said: said.slice(-6) }));
})();`,
  ].join("\n");
  if (process.env.QUIRE_SPREAD_DUMP) writeFileSync(process.env.QUIRE_SPREAD_DUMP, body);
  events.emit("affinity:page:start", { issue: issue.id, page: pages[0] });
  const out = await run(body, 600000);
  events.emit("affinity:page:done", { issue: issue.id, page: pages[0] });
  if (out.raw !== undefined) return { ok: false, error: "Affinity: " + String(out.raw).slice(0, 600) };
  return { ...out, sizes: Object.fromEntries(Object.entries(shaped.blocks).map(([id, b]) => [id, { w: b.w, h: b.h, lines: b.lines.length }])) };
}

/**
 * The issue's brand (core brand.ts), with its shape kit's source, or null. Read from the staged
 * core (prod) or the checkout (dev); a brand that is named but missing builds without its shapes.
 */
export function brandOf(issue) {
  const dir = issue && issue.brand ? brandDir(issue.brand) : null;
  if (!dir) return null;
  try {
    const data = JSON.parse(readFileSync(join(dir, "brand.json"), "utf-8"));
    const kitDir = join(dir, "kit");
    const kit = existsSync(kitDir) ? readdirSync(kitDir).filter((f) => f.endsWith(".js")).map((f) => readFileSync(join(kitDir, f), "utf-8")).join("\n") : "";
    return { ...data, kit };
  } catch { return null; }
}

/** The page's Bengali (brand bilingual rule): the section's name, folio digits, the Bengali line and word box, and any Bengali in its type. */
export function bengaliItems(issue, page, world, brand) {
  const items = [];
  const bnDigits = String(page.n).replace(/\d/g, (d) => "০১২৩৪৫৬৭৮৯"[Number(d)]);
  items.push({ text: bnDigits, face: "text", wght: 400 });
  if (world?.bn) items.push({ text: world.bn, face: "display" });
  for (const f of page.furniture || []) {
    const parts = String(f.text || "").split("|").map((x) => x.trim());
    if (f.kind === "bengali-line" && parts[0]) items.push({ text: parts[0], face: "display" });
    if (f.kind === "wordbox" && parts[0]) items.push({ text: parts[0], face: "mark" });
  }
  for (const t of [page.title, page.pullQuote]) if (t && BENGALI.test(t)) items.push({ text: t, face: "display" });
  if (page.deck && BENGALI.test(page.deck)) items.push({ text: page.deck, face: "text", wght: 300 });
  if (page.type === "cover" || page.n === 1) items.push({ text: brand.mark, face: "mark" });
  return items;
}

/** Column pouring shared by the whole-issue and the one-page layouts. Reads CTX = { pn, tag, ink }. */
const FLOW_JS = `
  // The body is a run of items (see bodyItems): words that know their
  // paragraph and whether it is a heading. Headings get their own face and
  // paragraph spacing; "###" never reaches the page.
  function runsOf(items) {
    var runs = [], i = 0;
    while (i < items.length) {
      var g = items[i].g, k = items[i].k, words = [];
      while (i < items.length && items[i].g === g) { words.push(items[i].t); i++; }
      if (runs.length) runs.push({ br: true });
      runs.push(k === "h"
        ? { pa: { align: "Left", hyph: false, lead: 16, space: runs.length ? 6 : 0, spaceAfter: 2 } }
        : { pa: { align: "Justify", hyph: true, spaceAfter: 4.5 } });
      runs.push(k === "h"
        ? { t: words.join(" "), fam: F.disp, face: FACE.dispReg, size: 13, color: CTX.ink }
        : { t: words.join(" "), color: CTX.ink });
    }
    return runs;
  }

  // How many items a frame holds. A heading is never the last thing in a
  // column: it would be stranded from the paragraph it introduces.
  function fit(x, y, w, h, items) {
    var lo = 1, hi = items.length, best = 0;
    while (lo <= hi) {
      var mid = (lo + hi) >> 1;
      var n = T.text(CTX.pn, x, y, w, h, runsOf(items.slice(0, mid)), { tag: "mag-probe" });
      if (T.overflows(n)) hi = mid - 1; else { best = mid; lo = mid + 1; }
    }
    T.kill("mag-probe", [CTX.pn]);
    while (best > 0 && best < items.length && items[best - 1].k === "h") best--;
    return best;
  }

  function place(x, y, w, h, items) {
    if (items.length) T.text(CTX.pn, x, y, w, h, runsOf(items), { tag: CTX.tag });
  }

  // Fill columns to the foot of the live area; what does not fit is returned.
  function pour(x, y, w, h, items) {
    var n = fit(x, y, w, h, items);
    if (!n) { if (items.length) log.push("no room for body"); return items; }
    place(x, y, w, h, items.slice(0, n));
    return items.slice(n);
  }

  // Two columns of the same depth. Pour at full depth first to learn whether the
  // copy fits at all, then find the shallowest foot that still holds all of it.
  function pourBalanced(xs, tops, w, foot, items) {
    var deep = Math.max(tops[0], tops[1]);
    function split(b) {
      var n1 = fit(xs[0], tops[0], w, b - tops[0], items);
      var rest = items.slice(n1);
      var n2 = fit(xs[1], tops[1], w, b - tops[1], rest);
      return { n1: n1, n2: n2, rest: rest };
    }
    var full = split(foot);
    if (full.n2 < full.rest.length) {
      place(xs[0], tops[0], w, foot - tops[0], items.slice(0, full.n1));
      place(xs[1], tops[1], w, foot - tops[1], full.rest.slice(0, full.n2));
      log.push((full.rest.length - full.n2) + " words overset");
      CTX.cols = { words: [full.n1, full.n2], overset: full.rest.length - full.n2 };
      return;
    }
    var lo = deep + 10, hi = foot, b = foot;
    while (hi - lo > 2.4) {
      var mid = (lo + hi) / 2, s = split(mid);
      if (s.n2 === s.rest.length) { hi = mid; b = mid; } else lo = mid;
    }
    var s2 = split(b);
    place(xs[0], tops[0], w, b - tops[0], items.slice(0, s2.n1));
    place(xs[1], tops[1], w, b - tops[1], s2.rest);
    // What the score reads for balance: words per column, and where they stop.
    CTX.cols = { words: [s2.n1, s2.rest.length], overset: 0, foot: Math.round(b * 10) / 10 };
  }
`;

/** One page's layout. The shared helpers are restated because each script is
 *  a fresh context — there is nowhere to keep them between calls. */
const BLOCK_KINDS = ["image", "drawn", "figure", "title", "deck", "kicker", "body", "dropcap",
  "pull", "panel", "runhead", "wordmark", "rule", "folio"];
const isSlot = (s) => !!s && typeof s === "object" && ["col", "span", "row", "rows"].every((k) => Number.isInteger(s[k]));

/**
 * The blocks a page is built from (core page-blocks.ts `placedBlocks`): its
 * own, after the brand's fixed furniture. Empty unless every block of the page
 * has a grid slot, so a half-structured page keeps its type's arrangement.
 */
export function blocksOf(issue, page) {
  const own = issue.design?.spec?.pages?.[String(page.n)]?.blocks || [];
  if (!own.length || !own.every((b) => BLOCK_KINDS.includes(b.kind) && isSlot(b.slot))) return [];
  // A cover is the brand's face: no running head, no folio.
  if (page.type === "cover") return own.filter((b) => b.kind !== "runhead" && b.kind !== "folio");
  const fixed = (issue.design?.fixed?.blocks || []).filter((b) => BLOCK_KINDS.includes(b.kind) && isSlot(b.slot)
    && !own.some((o) => o.kind === b.kind));
  return [...fixed, ...own];
}

/** "11,871 mm / year — rain in an average year" -> value, unit, caption. */
export function figureOf(page) {
  const f = (page.furniture || []).find((x) => x.kind === "pull-number");
  if (!f) return null;
  const m = /^\s*(\S*\d[\d.,%]*)\s*(.*)$/.exec(f.text);
  if (!m) return { value: f.text, unit: "", caption: "" };
  const [unit, caption] = m[2].split(/\s+[—–-]\s+/);
  return { value: m[1], unit: (unit || "").trim(), caption: (caption || "").trim() };
}

/** Sidefacts as label/value rows: "Rain, average year: 11,871 mm". */
export function notesOf(page) {
  return (page.furniture || []).filter((x) => x.kind === "sidefact" || x.kind === "did-you-know").map((x) => {
    const at = x.text.search(/:\s|\s[—–]\s/);
    return at > 0
      ? { label: x.text.slice(0, at).trim(), value: x.text.slice(at).replace(/^[:—–\s]+/, "").trim() }
      : { label: "", value: x.text.trim() };
  });
}

/**
 * A picture kept with its painted ground (treatment "plate"): the ground's edge colour and
 * grain as the art stage measured them (postprocess `ground`), and a grain tile at that
 * strength staged beside the pictures, so the page's shapes are drawn in that colour and
 * texture. Null for any other picture.
 */
export function plateOf(page, staged, colours = []) {
  const file = page.image || (page.images || []).find(Boolean);
  const pic = staged[String(page.n).padStart(2, "0") + ".png"];
  if (!file || !pic) return null;
  try {
    const r = JSON.parse(readFileSync(String(file).replace(/\.png$/i, ".recipe.json"), "utf-8"));
    const m = (r.postProcess || []).find((x) => x && x.op === "ground");
    if (r.treatment !== "plate" || !m || !m.edge) return null;
    const level = Math.max(0, Math.round(Number(m.grain) || 0));
    // The grain as measured (brightness and colour apart), and the picture's pixel size from
    // its PNG header, which the page needs to lay the tiles at the picture's own scale.
    const g = m.lum != null ? { lum: m.lum, chroma: m.chroma } : level;
    const head = readFileSync(String(file));
    const size = [head.readUInt32BE(16), head.readUInt32BE(20)];
    // One tile per colour the page can draw in, the plate's own ground among them.
    const tiles = {};
    if (level) for (const hex of new Set([m.edge, ...colours].filter((c) => /^#[0-9a-f]{6}$/i.test(String(c))).map((c) => c.toLowerCase()))) {
      const tile = join(dirname(pic), `grain-${hex.slice(1)}-${typeof g === "number" ? g : `${g.lum}-${g.chroma}`}.png`);
      if (!existsSync(tile)) writeFileSync(tile, colourGrain(hex, g));
      tiles[hex] = win(tile);
    }
    return { edge: m.edge, ground: m.ground || m.edge, grain: level ? { tiles, px: 512, mm: 64 } : null, size,
      ...(Array.isArray(m.subject) ? { subject: m.subject } : {}), cut: Array.isArray(m.cut) ? m.cut : [] };
  } catch { return null; }
}

export function onePageScript(issue, page, world, staged, brand = null) {
  const section = (issue.sections || []).find((s) => page.n >= s.from && page.n <= s.to);
  const p = {
    n: page.n, type: page.type, density: page.density, section: page.section,
    title: page.title || "", deck: page.deck || "", items: bodyItems(page.body),
    pull: page.pullQuote || "", furniture: (page.furniture || []).slice(0, 4),
    image: staged[String(page.n).padStart(2, "0") + ".png"] || null,
    treatment: (page.briefs && page.briefs[0] && page.briefs[0].treatment) || null,
    plate: plateOf(page, staged, [world?.paper, world?.ink, world?.hue, issue.design?.spec?.palette?.accent,
      ...Object.values(world?.language || {}).filter((v) => typeof v === "string")]),
    link: linkOf(page),
    // How the page score last asked this page to be arranged (page-score-run.ts).
    variant: issue.design?.spec?.pages?.[String(page.n)]?.variant || null,
    // Whether this map page is the left half of a two-page map.
    spread: page.type === "map" && page.n % 2 === 0
      && (issue.pages || []).some((q) => q.n === page.n + 1 && q.type === "map"),
    mapRight: page.type === "map" && page.n % 2 === 1
      && (issue.pages || []).some((q) => q.n === page.n - 1 && q.type === "map"),
    // Built from the spec when it says how (Phase 5); otherwise by type, below.
    blocks: blocksOf(issue, page),
    // The house's masthead (core house.ts); the series slug only before a house exists.
    brand: issue.design?.fixed?.masthead || issue.series || "", issueTitle: issue.title || "",
    sectionLabel: section?.label || "",
    figure: figureOf(page), notes: notesOf(page),
    scale: issue.design?.spec?.type?.scale || [],
    accent: issue.design?.spec?.palette?.accent || null,
    // The page's grid lines and the house's devices (core layout-engine.ts, house.ts).
    edges: issue.design?.spec?.pages?.[String(page.n)]?.edges || null,
    panelStyle: issue.design?.fixed?.panel || "filled",
    ruleStyle: issue.design?.fixed?.rule || "hairline",
    // The page's art, composed by the model (core page-art.ts), drawn in its section's colours.
    shapes: issue.design?.spec?.pages?.[String(page.n)]?.shapes || [],
    // The brand (core brand.ts): its Bengali shaped in Node (bengali.mjs), its bilingual furniture.
    brandMode: brand ? { id: brand.id, name: brand.name, bn: brand.bn, sectionBn: world?.bn || "",
      digits: String(page.n).replace(/\d/g, (d) => "০১২৩৪৫৬৭৮৯"[Number(d)]),
      line: (() => { const f = (page.furniture || []).find((x) => x.kind === "bengali-line"); if (!f) return null; const [b, e] = String(f.text).split("|").map((x) => x.trim()); return b ? { bn: b, en: e || "" } : null; })(),
      word: (() => { const f = (page.furniture || []).find((x) => x.kind === "wordbox"); if (!f) return null; const [w, snd, mean] = String(f.text).split("|").map((x) => x.trim()); return w ? { bn: w, sound: snd || "", meaning: mean || "" } : null; })(),
    } : null,
  };

  return `(function () {
  const T = globalThis.TK;
  if (!T) throw new Error("toolkit not loaded");
  const P = ${JSON.stringify(p)};
  const MAP = ${JSON.stringify(mapData(issue))};
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

  // Each frame says what it is after the colon; INSPECT reports it with its box.
  const R_ = function (role) { return TAG + ":" + role; };
  var CTX = { pn: P.n, tag: R_("body"), ink: INK };
  ${FLOW_JS}

  // A brand string's shaped outlines (bengali.mjs), by text and face.
  function BN(t, face) { return P.brandMode && P.brandMode.bn ? P.brandMode.bn[String(t).trim() + "|" + face] : null; }
  function folio() {
    if (P.n === 1 || P.type === "plate" || P.type === "cover") return;   // plates and covers carry no folio
    var L = T.live(P.n);
    if (P.brandMode) {
      // Bengali digits, then "Ochin · issue title", at the foot's outer corner (brand house.folio).
      var dg = BN(P.brandMode.digits, "text"), fx = L.recto ? L.x1 : L.x0, words = P.brandMode.name + " \u00B7 " + P.issueTitle;
      var dwid = dg ? dg.words.reduce(function (a, wd) { return a + wd.w * .8; }, 0) : 4;   // size 8 = 0.8 of the 10 pt it was shaped at
      if (L.recto) {
        T.text(P.n, fx - 90, 279, 90 - dwid - 4, 6, [{ t: words, fam: F.sans, size: 7.5, color: INK }], { tag: R_("folio"), align: "Right" });
        if (dg) T.bn(P.n, fx - dwid, 278.6, dwid + 1, dg, INK, { size: 8, tag: R_("folio-bn") });
      } else {
        if (dg) T.bn(P.n, fx, 278.6, dwid + 1, dg, INK, { size: 8, tag: R_("folio-bn") });
        T.text(P.n, fx + dwid + 4, 279, 90, 6, [{ t: words, fam: F.sans, size: 7.5, color: INK }], { tag: R_("folio") });
      }
      if (P.link) T.linkNote(P.n, P.link, { tag: TAG });
      return;
    }
    T.text(P.n, L.recto ? L.x1 - 20 : L.x0, 277, 20, 6,
      [{ t: String(P.n), fam: F.sans, size: 8, color: INK }],
      { tag: R_("folio"), align: L.recto ? "Right" : "Left" });
    // The page it is tied to, in the accent: the brand's connection line.
    if (P.link) T.linkNote(P.n, P.link, { tag: TAG });
  }

  var L = T.live(P.n);
  T.MISSING.forEach(function (f) { log.push("font " + f + " is not installed; set in the house face"); });
  var BUILT = null;

  // ---- built from blocks (Phase 5, core page-blocks.ts) -------------------
  function blockPage() {
    var G = T.blockGrid();
    var LANG = (W && W.language) || null;
    var ACC = (LANG && LANG.accent) || P.accent || FIELD;
    // A plate's painted ground: its edge colour is a role ("ground") and its grain textures
    // every flat shape on the page, so drawn colour and the painting read as one surface.
    var PLATE = P.image && P.treatment === "plate" ? P.plate : null;
    var GRAIN = PLATE ? PLATE.grain : null;
    var HEX = { ink: INK, paper: PAPER, accent: ACC, field: FIELD,
      second: (LANG && LANG.second) || ACC, third: (LANG && LANG.third) || FIELD,
      ground: PLATE ? PLATE.edge : null };
    // Colour arithmetic, so type on art and panels picks what reads (WCAG contrast).
    function hx(h) { h = String(h || "#000000").replace("#", ""); return [0, 2, 4].map(function (i) { return parseInt(h.substr(i, 2), 16) / 255; }); }
    function lum(h) { var v = hx(h).map(function (c) { return c <= .03928 ? c / 12.92 : Math.pow((c + .055) / 1.055, 2.4); }); return .2126 * v[0] + .7152 * v[1] + .0722 * v[2]; }
    function cr(a, b) { var x = lum(a), y = lum(b); return (Math.max(x, y) + .05) / (Math.min(x, y) + .05); }
    function best(bg) { return cr(INK, bg) >= cr(PAPER, bg) ? INK : PAPER; }
    function mixHex(a, b, t) { var x = hx(a), y = hx(b); return "#" + x.map(function (v, i) { return ("0" + Math.round((v + (y[i] - v) * t) * 255).toString(16)).slice(-2); }).join(""); }
    // The layout engine computes boxes; a hand-placed block is boxed here.
    function boxOf(b) { return b.box ? b.box : box(b.slot); }
    var PT2MM = 25.4 / 72, BODY = 9.5, LEAD = 13.5 * PT2MM;
    function box(s) {
      var x = G.x0 + (s.col - 1) * (G.colw + G.gut), w = s.span * G.colw + (s.span - 1) * G.gut;
      var y = G.top + s.row * G.base, h = s.rows * G.base;
      if (s.bleed) {
        if (s.col === 1) { w += x; x = 0; }
        if (s.col + s.span - 1 === G.cols) w = 210 - x;
        if (s.row === 0) { h += y; y = 0; }
        if (s.row + s.rows === G.rows) h = 297 - y;
      }
      return { x: x, y: y, w: w, h: h };
    }
    function meets(a, b) { return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h; }
    // Same defaults as core sizeOf, so the score checks the sizes that were set.
    var S = P.scale.filter(function (n) { return n > 0; }).sort(function (a, b) { return b - a; });
    var TOP = S[0] || 28, MID = S[1] || TOP / 2;
    function size(b) {
      if (b.size) return b.size;
      return b.kind === "title" ? TOP : b.kind === "pull" ? MID
        : b.kind === "deck" ? Math.max(BODY * 1.2, Math.min(MID * 0.6, BODY * 1.6)) : 7.5;
    }

    var G0 = T.rect(P.n, 0, 0, 210, 297, { tag: R_("ground"), fill: PAPER });
    var pics = [];
    var ART = P.shapes && P.shapes.length;
    var layer = function (which) { return P.shapes.filter(function (s) { return (s.layer || "back") === which; }); };
    // A shape that stands under the whole of a block, solidly, is the ground its type is set on.
    function grounds(list) {
      list.forEach(function (s) {
        if ((s.opacity == null ? 1 : s.opacity) >= .6 && s.fill && (s.s === "rect" || s.s === "circle" || s.s === "blob" || s.s === "poly")) {
          pics.push({ x: s.x, y: s.y, w: s.w, h: s.h, bg: HEX[s.fill] });
        }
      });
    }
    // A page with a picture slot (filled or a placeholder) puts its "back" shapes behind it.
    var SLOTTED = P.image || P.blocks.some(function (b) { return b.kind === "image"; });
    // They are grounds too: a deck set on a block of colour reads in whichever of ink or
    // paper holds against it, not in ink by default.
    // A shape that holds the plate is drawn with the picture, below.
    var HOLD = PLATE ? P.shapes.find(function (s) { return s.hold; }) : null;
    var BACK = ART ? layer("back").filter(function (s) { return s !== HOLD; }) : [];
    // Grain is laid at the picture's own scale (mm per pixel as placed), so the shapes' speckle
    // is the painting's speckle. ponytail: a plate with no holding shape assumes a contained fit.
    if (GRAIN && PLATE.size) {
      var IMB = P.blocks.find(function (b) { return b.kind === "image"; }), ib = IMB ? boxOf(IMB) : null;
      var kmm = HOLD ? T.plateFit(HOLD, { size: PLATE.size, subject: PLATE.subject, cut: PLATE.cut }).k
        : ib ? Math.min(ib.w / PLATE.size[0], ib.h / PLATE.size[1]) : 0;
      if (kmm > 0) GRAIN.mm = GRAIN.px * kmm;
    }
    if (GRAIN) T.texture(G0, PAPER, GRAIN);
    if (ART && SLOTTED) { T.shapes(P.n, BACK, HEX, { tag: R_("art"), log: log, grain: GRAIN }); grounds(BACK); }
    // Pictures first: everything else is set over or beside them.
    P.blocks.forEach(function (b) {
      if (b.kind !== "image" && b.kind !== "drawn") return;
      var r = boxOf(b); pics.push({ x: r.x, y: r.y, w: r.w, h: r.h, bg: b.kind === "drawn" ? FIELD : null });
      if (b.kind === "image" && !P.image) {
        // The wireframe: a grey plate at the slot's exact size, labelled with what the picture
        // will show, so the page is judged as composed and the slot can be generated to fit.
        // Filled at the tone the composer promised, so type set on it is judged on the
        // ground the picture will give it; the brief sits in a corner, off the type.
        var br = b.brief || {};
        var TONE = { dark: "#3a3a3a", mid: "#8c8c8c", light: "#d4d4d4" }[br.tone] || "#8c8c8c";
        var on = br.tone === "dark" ? "#bdbdbd" : "#2e2e2e";
        pics[pics.length - 1].bg = TONE;
        T.rect(P.n, r.x, r.y, r.w, r.h, { fill: TONE, tag: R_("image") });
        T.line(P.n, r.x, r.y, r.x + r.w, r.y + r.h, { fill: on, alpha: .25, t: .3, tag: R_("image") + "-x" });
        T.line(P.n, r.x + r.w, r.y, r.x, r.y + r.h, { fill: on, alpha: .25, t: .3, tag: R_("image") + "-x" });
        var lx = Math.max(r.x + 4, 8), lw = Math.min(r.w - 8, 90);
        T.label(P.n, lx, Math.max(r.y + 4, 8), lw, "PICTURE · " + (br.id || ("p" + P.n)) + " · " + (br.tone || "mid"),
          { size: 6, color: on, track: .12, tag: R_("image") + "-lab" });
        if (br.shows) T.text(P.n, lx, Math.min(r.y + r.h, 289) - 16, lw, 12,
          [{ t: br.shows, fam: F.body, ital: true, size: 6, color: on }], { tag: R_("image") + "-brief", lead: 7.5 });
        return;
      }
      if (ART && (b.kind === "drawn" || !P.image)) {
        // The page has its own art: the slot is its field, the shapes are drawn over it below.
        if (FIELD !== PAPER) T.rect(P.n, r.x, r.y, r.w, r.h, { tag: R_("drawn"), fill: FIELD });
        else pics.pop();
      } else if (b.kind === "drawn") {
        // Type that sits on the art is kept clear: strokes stop short of it.
        var quiet = P.blocks.filter(function (q) { return q !== b && q.kind !== "drawn" && q.kind !== "image" && q.kind !== "rule"; })
          .map(boxOf).filter(function (q) { return meets(q, r); })
          .map(function (q) { return { x: q.x - 2.5, y: q.y - 2.5, w: q.w + 5, h: q.h + 5 }; });
        var ink = best(FIELD);
        T.drawn(P.n, r.x, r.y, r.w, r.h, { kind: b.drawn, seed: b.seed, field: FIELD, line: ink, paper: ink,
          mark: ACC, label: b.text || "", quiet: quiet, tag: R_("drawn"), artTag: R_("art") });
      } else if (P.image) {
        // A cutout stands whole on the page's paper, inside its frame; a plate covers it.
        if (HOLD) {
          T.held(P.n, HOLD, HEX, P.image, { tag: R_("image"), grain: GRAIN, subject: PLATE.subject, cut: PLATE.cut, size: PLATE.size });
          pics[pics.length - 1] = { x: HOLD.x, y: HOLD.y, w: HOLD.w, h: HOLD.h, bg: PLATE.edge };
        } else T.img(P.n, r.x, r.y, r.w, r.h, P.image, { tag: R_("image"), contain: !b.slot.bleed || P.treatment === "cutout" });
      } else {
        T.ph(P.n, r.x, r.y, r.w, r.h, "p" + P.n, (P.treatment || ""), { tag: R_("image"), accent: ACC });
      }
    });
    // Over the art fields, under the panels and the type. With a photograph on the
    // page, "back" shapes go behind it and only "front" ones over it.
    if (ART) {
      var over = SLOTTED ? layer("front") : P.shapes;
      T.shapes(P.n, over, HEX, { tag: R_("art"), log: log, grain: GRAIN });
      grounds(over);
    }
    // The topmost ground a block sits on decides its colour.
    function picUnder(r) { return pics.filter(function (q) { return meets(q, r); }).slice(-1)[0] || null; }
    function colour(b, r, fallback) {
      if (HEX[b.color]) return HEX[b.color];
      if (fallback) return HEX[fallback];
      var q = picUnder(r);
      return q ? (q.bg ? best(q.bg) : PAPER) : INK;
    }

    var dropcap = P.blocks.find(function (b) { return b.kind === "dropcap"; });
    P.blocks.forEach(function (b) {
      var r = boxOf(b);
      if (b.kind === "title" && P.title) {
        var tc = colour(b, r), under = picUnder(r), want = LANG && HEX[LANG.title];
        if (want && cr(want, under && under.bg ? under.bg : PAPER) >= 3) tc = want;
        // The brand's matra: every headline hangs from a rule in its own colour.
        if (P.brandMode) T.rect(P.n, r.x, r.y - 2.6, r.w, 1.1, { fill: tc, tag: R_("matra") });
        var tb = P.brandMode && BN(P.title, "display");
        if (tb) { T.bn(P.n, r.x, r.y, r.w, tb, tc, { size: Math.min(size(b), 42), tag: R_("title") }); return; }
        var ts = size(b), runs = function (s) { return [{ t: P.title, fam: F.disp, face: FACE.dispReg, size: s, color: tc }]; };
        // Set at its size, smaller only if the slot cannot hold it.
        var probe = T.text(P.n, r.x, r.y, r.w, r.h, runs(ts), { tag: "mag-probe", lead: ts });
        var over = T.overflows(probe); T.kill("mag-probe", [P.n]);
        if (over) T.fitText(P.n, r.x, r.y, r.w, r.h, runs, ts * 0.5, ts, { tag: R_("title"), lead: 1.0 });
        else T.text(P.n, r.x, r.y, r.w, r.h, runs(ts), { tag: R_("title"), lead: ts });
      } else if (b.kind === "deck" && P.deck) {
        var ds = size(b);
        var dc = colour(b, r);
        // Fitted to its slot: a deck set at its size over a short slot ran into the body below.
        var dk = T.fitText(P.n, r.x + 4, r.y, r.w - 4, r.h, function (s) {
          return [{ t: P.deck, fam: F.body, ital: true, size: s, color: dc }];
        }, Math.max(8.5, ds * 0.6), ds, { tag: R_("deck"), lead: 1.3 });
        var dlines = Math.max(1, Math.ceil(P.deck.length * dk.size * PT2MM * 0.46 / (r.w - 4)));
        // A deck on a block of colour is set off by the block; the inset rule is for a deck on paper.
        var dg = picUnder(r);
        if (!(dg && dg.bg)) T.vr(P.n, r.x, r.y, Math.min(r.h, dlines * dk.size * 1.3 * PT2MM + 1), { fill: ACC, t: .6, tag: R_("rule") });
      } else if (b.kind === "kicker") {
        var kt = b.text || [P.type, P.sectionLabel].filter(Boolean).join(" · ");
        // Open values (core visual-language.ts); an older issue named "tag" or "bar".
        var KS = LANG ? LANG.kicker : null;
        if (typeof KS === "string") KS = { ground: KS === "tag" ? "accent" : null, bar: KS === "bar" ? "accent" : null, track: .16 };
        KS = KS || { ground: null, bar: null, track: .16 };
        var kx = r.x, kc = colour(b, r);
        if (KS.bar && HEX[KS.bar]) { T.rect(P.n, kx, r.y + size(b) * PT2MM * .3, 7, 1.4, { fill: HEX[KS.bar], tag: R_("rule") }); kx += 9; }
        if (KS.ground && HEX[KS.ground]) {
          var kg = HEX[KS.ground], kw = Math.min(r.w - (kx - r.x), kt.length * size(b) * PT2MM * (.62 + KS.track) + 6);
          T.rect(P.n, kx, r.y - .6, kw, Math.min(r.h, size(b) * PT2MM * 1.9), { fill: kg, tag: R_("panel") });
          T.label(P.n, kx + 3, r.y + .4, kw - 4, kt, { size: size(b), color: best(kg), tag: R_("kicker"), track: KS.track, h: r.h });
        } else if (P.brandMode) {
          // The brand's eyebrow: label caps in sindur, the section's Bengali name beside it.
          var kcol = cr(HEX.third, picUnder(r) && picUnder(r).bg ? picUnder(r).bg : PAPER) >= 3 ? HEX.third : kc;
          T.label(P.n, kx, r.y, r.w - (kx - r.x), kt, { size: size(b), color: kcol, tag: R_("kicker"), track: KS.track, h: r.h });
          var kb = P.brandMode.sectionBn && BN(P.brandMode.sectionBn, "display");
          var kw = kt.length * size(b) * PT2MM * (.62 + KS.track);
          if (kb && kw + 6 < r.w) T.bn(P.n, kx + kw + 3, r.y - .4, r.w - kw - 3, kb, kcol, { size: size(b) * 1.25, tag: R_("kicker-bn") });
        } else T.label(P.n, kx, r.y, r.w - (kx - r.x), kt, { size: size(b), color: kc, tag: R_("kicker"), track: KS.track, h: r.h });
      } else if (b.kind === "runhead") {
        var rc = colour(b, r);
        T.label(P.n, r.x, r.y, r.w * .6, [P.brand, P.issueTitle].filter(Boolean).join(" — "), { size: 7, color: rc, tag: R_("runhead"), track: .14, h: r.h - .8 });
        if (P.sectionLabel) T.label(P.n, r.x + r.w * .6, r.y, r.w * .4, P.sectionLabel, { size: 7, color: rc, align: "Right", tag: R_("runhead"), track: .14, h: r.h - .8 });
        T.hr(P.n, r.x, r.y + r.h - .5, r.w, { fill: rc, alpha: .45, t: .25, tag: R_("rule") });
      } else if (b.kind === "wordmark" && P.brand) {
        // The display face at its heaviest: wide enough that the measure, not
        // the slot's height, is what stops it - a wordmark spans its slot.
        T.fitText(P.n, r.x, r.y, r.w, r.h, function (s) {
          return [{ t: P.brand.toUpperCase(), fam: F.disp, face: FACE.disp, size: s, color: colour(b, r) }];
        }, 12, r.h / PT2MM * 1.4, { tag: R_("wordmark"), lead: .82 });
      } else if (b.kind === "figure" && P.figure) {
        var fc = colour(b, r, "accent");
        // The unit sits on the frame's last line, inside it: under the frame it ran into
        // whatever the composer placed below (Swing Drumming p2).
        var fh = P.figure.unit ? r.h - 5 : r.h;
        T.fitText(P.n, r.x, r.y, r.w, fh, function (s) {
          return [{ t: P.figure.value, fam: F.disp, face: FACE.dispReg, size: s, color: fc }];
        }, 12, fh / PT2MM * 1.45, { tag: R_("figure"), lead: .8 });
        // h 4: a label is 6 mm tall by default, which hung 2 mm under the frame into the body (Rain p2).
        if (P.figure.unit) T.label(P.n, r.x, r.y + r.h - 4, r.w, P.figure.unit, { size: 7.5, color: colour(b, r), tag: R_("figure"), track: .14, h: 4 });
      } else if (b.kind === "pull" && P.pull) {
        var ps = size(b);
        T.hr(P.n, r.x, r.y, r.w, { fill: INK, t: .25, tag: R_("rule") });
        var pc = picUnder(r) ? colour(b, r) : (cr(ACC, PAPER) >= 3 ? ACC : INK);
        T.fitText(P.n, r.x, r.y + 3, r.w, r.h - 6, function (s) {
          return [{ t: "\u201C" + P.pull + "\u201D", fam: F.disp, face: FACE.dispReg, size: s, color: pc }];
        }, 9, ps, { tag: R_("pull"), lead: 1.15 });
        T.hr(P.n, r.x, r.y + r.h, r.w, { fill: INK, t: .25, tag: R_("rule") });
      } else if (b.kind === "panel" && (P.notes.length || P.figure)) {
        // A page with a figure and no figure block carries it as the panel's first row.
        var rows = P.notes.slice();
        if (P.figure && !P.blocks.some(function (x) { return x.kind === "figure"; })) {
          rows.unshift({ label: P.figure.caption || "", value: P.figure.value + (P.figure.unit ? " " + P.figure.unit : "") });
        }
        // As tall as what it holds, never taller than its slot: an empty field reads as a hole.
        // Each value is sized by its length, so a sentence is not set at display size.
        var pw = r.w - 9, sized = rows.map(function (nt) {
          var vs = nt.value.length > 34 ? 10 : 14;
          var lines = Math.max(1, Math.ceil(nt.value.length * vs * PT2MM * 0.5 / pw));
          return { nt: nt, vs: vs, vh: lines * vs * PT2MM * 1.25 + 1.5 };
        });
        var need = 13, fitRows = 0;
        for (var j = 0; j < sized.length; j++) {
          var lj = sized[j].nt.label ? Math.max(1, Math.ceil(sized[j].nt.label.length * 6.2 * PT2MM * 0.62 / pw)) * 3.4 + 1.6 : 0;
          var hj = lj + sized[j].vh + (j < sized.length - 1 ? 3.5 : 0);
          if (need + hj + 4 > r.h) break;
          need += hj; fitRows++;
        }
        var ph = Math.min(r.h, need + 4), PS = P.panelStyle, bg;
        if (LANG) {
          bg = T.panel(P.n, r.x, r.y, r.w - 2.4, ph - 2.4, LANG.panel, HEX, { tag: R_("panel") }).fill;
        } else {
          bg = PS === "outlined" || PS === "rule-top" ? PAPER : PS === "tinted" ? mixHex(PAPER, ACC, .14) : FIELD;
          if (PS === "outlined") T.rect(P.n, r.x, r.y, r.w, ph, { stroke: INK, weight: .5, tag: R_("panel") });
          else if (PS === "rule-top") T.rect(P.n, r.x, r.y, r.w, 1.2, { fill: ACC, tag: R_("panel") });
          else if (PS === "corner-cut") T.polyline(P.n, [[r.x, r.y], [r.x + r.w - 7, r.y], [r.x + r.w, r.y + 7], [r.x + r.w, r.y + ph], [r.x, r.y + ph]], { fill: bg, tag: R_("panel") });
          else T.rect(P.n, r.x, r.y, r.w, ph, { fill: bg, tag: R_("panel") });
        }
        var on = best(bg), head = cr(ACC, bg) >= 3 && bg !== ACC ? ACC : on;
        var py = r.y + 5;
        T.label(P.n, r.x + 4.5, py, pw, b.text || "Notes", { size: 7, color: head, tag: R_("notes"), track: .16 });
        py += 8;
        for (var i = 0; i < fitRows; i++) {
          var it = sized[i];
          // A label as tall as its lines: a two-line label set in one line's height sat on its value.
          if (it.nt.label) {
            var lh = Math.max(1, Math.ceil(it.nt.label.length * 6.2 * PT2MM * 0.62 / pw)) * 3.4;
            T.label(P.n, r.x + 4.5, py, pw, it.nt.label, { size: 6.2, color: on, tag: R_("notes"), track: .12, h: lh + 1 }); py += lh + 1.6;
          }
          T.fitText(P.n, r.x + 4.5, py, pw, it.vh, function (sz) {
            return [{ t: it.nt.value, fam: F.disp, face: FACE.dispReg, size: sz, color: on }];
          }, 7.5, it.vs, { tag: R_("notes"), lead: 1.2 });
          py += it.vh;
          if (i < fitRows - 1) { T.hr(P.n, r.x + 4.5, py, pw, { fill: on, alpha: .3, t: .25, tag: R_("rule") }); py += 3.5; }
        }
      } else if (b.kind === "rule") {
        T.rule(P.n, r.x, r.y, r.w, P.ruleStyle, { fill: colour(b, r), tag: R_("rule") });
      } else if (b.kind === "body") {
        var cols = b.columns || (r.w > 120 ? 2 : 1);
        var cw = cols === 2 ? (r.w - G.gut) / 2 : r.w;
        var items = P.items.slice();
        // Body on a coloured field reads in whichever of ink or paper holds against it.
        var under = picUnder(r);
        CTX.ink = under && under.bg ? best(under.bg) : INK;
        CTX.measure = { chars: Math.round(cw / (BODY * PT2MM * 0.47)) };
        var tops = [r.y, r.y];
        if (dropcap && items.length && items[0].k !== "h") {
          // The cap stands in N body lines; the words beside it are their own frame.
          var letter = items[0].t.charAt(0);
          // As wide as its letter: a narrow I in a frame cut for a W left "I  nside" (Birds p14).
          var n = dropcap.lines || 3, capMm = ((n - 1) * LEAD + 0.7 * BODY * PT2MM) / 0.7,
            capW = capMm * (/[IJlij1]/.test(letter) ? 0.42 : /[MW]/.test(letter) ? 0.95 : 0.72);
          items[0] = Object.assign({}, items[0], { t: items[0].t.slice(1) });
          T.text(P.n, r.x, r.y - LEAD * 0.18, capW, n * LEAD, [{ t: letter, fam: F.disp, face: FACE.dispReg, size: capMm / PT2MM, color: HEX[dropcap.color] || ACC }],
            { tag: R_("dropcap"), lead: capMm / PT2MM * 0.8 });
          var k = fit(r.x + capW + 1.2, r.y, cw - capW - 1.2, n * LEAD, items);
          place(r.x + capW + 1.2, r.y, cw - capW - 1.2, n * LEAD, items.slice(0, k));
          items = items.slice(k);
          tops[0] = r.y + n * LEAD;
        }
        if (cols === 2) pourBalanced([r.x, r.x + cw + G.gut], tops, cw, r.y + r.h, items);
        else {
          var rest = pour(r.x, tops[0], cw, r.y + r.h - tops[0], items);
          CTX.cols = { words: [P.items.length - rest.length], overset: rest.length };
          if (rest.length) log.push(rest.length + " words overset");
        }
      }
    });
    if (P.brandMode) bilingual(HEX);
    BUILT = { x0: P.edges ? P.edges[0] : G.x0, x1: P.edges ? P.edges[P.edges.length - 1] : G.x1, top: G.top, foot: G.foot, col: G.colw, gut: G.gut, ncol: G.cols, edges: P.edges };
    folio();
  }

  // The brand's bilingual furniture (core brand.ts): set where the page has room, never over anything.
  function bilingual(HEX) {
    var B = P.brandMode, G = T.blockGrid();
    var taken = P.blocks.filter(function (b) { return b.kind !== "rule"; }).map(function (b) {
      var r = b.box ? b.box : { x: G.x0 + (b.slot.col - 1) * (G.colw + G.gut), y: G.top + b.slot.row * G.base, w: b.slot.span * G.colw + (b.slot.span - 1) * G.gut, h: b.slot.rows * G.base };
      return { x: r.x - 2, y: r.y - 2, w: r.w + 4, h: r.h + 4 };
    });
    function clear(x, y, w, h) {
      if (x < G.x0 - .5 || x + w > G.x1 + .5 || y < 12 || y + h > 274) return false;
      return !taken.some(function (q) { return x < q.x + q.w && q.x < x + w && y < q.y + q.h && q.y < y + h; });
    }
    // Under the deck, the pull or the title first; then the foot of any column run above the folio.
    function spot(w, h) {
      var near = P.blocks.filter(function (b) { return ["deck", "pull", "title", "panel"].indexOf(b.kind) >= 0; });
      for (var i = 0; i < near.length; i++) {
        var r = near[i].box || null; if (!r) continue;
        var ww = Math.min(w, r.w);
        if (clear(r.x, r.y + r.h + 3, ww, h)) return { x: r.x, y: r.y + r.h + 3, w: ww };
      }
      for (var c = 0; c + 1 < G.cols; c++) {
        var x = G.x0 + c * (G.colw + G.gut), ww2 = Math.min(w, G.x1 - x);
        for (var y = 270 - h; y > 40; y -= G.base) if (clear(x, y, ww2, h)) return { x: x, y: y, w: ww2 };
      }
      return null;
    }
    if (B.line) {
      var lb = BN(B.line.bn, "display"), at = lb ? spot(92, 16 + (B.line.en ? 6 : 0)) : null;
      if (at) {
        var m = T.bn(P.n, at.x, at.y, at.w, lb, INK, { size: 15, lead: 19, tag: R_("bengali") });
        if (B.line.en) T.text(P.n, at.x, at.y + m.h + 1.5, at.w, 6, [{ t: B.line.en, fam: F.disp, ital: true, size: 9.2, color: INK }], { tag: R_("bengali-en"), lead: 13.4 });
        taken.push({ x: at.x - 2, y: at.y - 2, w: at.w + 4, h: m.h + 12 });
      } else log.push(lb ? "no room for the Bengali line" : "the Bengali line could not be shaped");
    }
    if (B.word) {
      var wb = BN(B.word.bn, "mark"), wat = wb ? spot(62, 30) : null;
      if (wat) {
        T.hr(P.n, wat.x, wat.y, wat.w, { fill: HEX.third, t: .5, tag: R_("wordbox-rule") });
        var wm = T.bn(P.n, wat.x, wat.y + 2.5, wat.w, wb, HEX.third, { size: 28, lead: 30, tag: R_("wordbox") });
        var ty = wat.y + 2.5 + (wm ? wm.h : 10) + 1;
        if (B.word.sound) { T.label(P.n, wat.x, ty, wat.w, B.word.sound, { size: 8.4, color: INK, tag: R_("wordbox-sound"), track: .1, h: 4.4 }); ty += 4.6; }
        if (B.word.meaning) T.text(P.n, wat.x, ty, wat.w, 30 - (ty - wat.y), [{ t: B.word.meaning, fam: F.body, size: 9.2, color: INK }], { tag: R_("wordbox-text"), lead: 13.4 });
      } else log.push(wb ? "no room for the word box" : "the word box could not be shaped");
    }
  }

  if (P.blocks.length) {
    blockPage();
  } else if (P.type === "map") {
    // The right half of a two-page map is drawn with its left; it keeps its folio.
    if (!P.mapRight) {
      T.rect(P.n, 0, 0, P.spread ? 420 : 210, 297, { tag: R_("ground"), fill: PAPER });
      if (P.title) T.text(P.n, L.x0, T.bl(0), T.gw(4), 20,
        [{ t: P.title, fam: F.disp, face: FACE.dispReg, size: 26, color: INK }], { tag: R_("title"), lead: 28 });
      if (P.deck) T.text(P.n, L.x0, T.bl(0) + 22, T.gw(4), 15,
        [{ t: P.deck, fam: F.cond, size: 12, color: INK }], { tag: R_("deck"), lead: 15 });
      pour(L.x0, T.bl(0) + 40, T.gw(3), 30, P.items);
      T.webMap(P.n, MAP, { tag: TAG, spread: P.spread });
    }
    folio();
  } else if (P.type === "cover" || P.type === "plate" || P.type === "photo-spread") {
    if (P.image) T.img(P.n, 0, 0, 210, 297, P.image, { tag: R_("image"), cover: true });
    else T.rect(P.n, 0, 0, 210, 297, { tag: R_("ground"), fill: FIELD });
    if (P.type === "cover") {
      T.text(P.n, L.x0, 150, L.w, 90,
        [{ t: TITLE, fam: F.disp, face: FACE.disp, size: 64, color: C.onDark }],
        { tag: R_("title"), lead: 62 });
    } else if (P.deck) {
      T.text(P.n, L.x0, 232, T.gw(4), 24,
        [{ t: P.deck, fam: F.disp, face: FACE.dispIt, size: 20, color: C.onDark }],
        { tag: R_("title"), lead: 24 });
    }
    folio();
  } else if (P.type === "statement" || P.density === "D") {
    T.rect(P.n, 0, 0, 210, 297, { tag: R_("ground"), fill: PAPER });
    if (P.image) T.img(P.n, L.x0, 150, L.w, 100, P.image, { tag: R_("image"), contain: true });
    T.text(P.n, L.x0, T.bl(4), L.w, 100,
      [{ t: P.deck || P.title, fam: F.disp, face: FACE.dispReg, size: 34, color: INK }],
      { tag: R_("title"), lead: 38 });
    folio();
  } else {
    T.rect(P.n, 0, 0, 210, 297, { tag: R_("ground"), fill: PAPER });
    // Image first: it is placed behind, and the bands below never re-enter it.
    // A content-heavy page earns a smaller picture, or the body oversets.
    var IMG_H = P.variant === "small-band" ? 58 : P.variant === "large-band" ? 120 : P.density === "C" ? 58 : 92;
    var top = T.bl(0);
    // A cutout sits on the outer edge beside the type, not in a band above it
    // (08 §5). The script API cannot create a text wrap, so the wrap is
    // stepped: the outer column starts below the cutout, the inner at the head.
    var cut = P.image && P.treatment === "cutout"
      ? T.cutout(P.n, top, T.gw(2), IMG_H + 24, P.image, { tag: R_("image") }) : null;
    var headX = cut && !L.recto ? L.x0 + T.gw(2) + T.GUT : L.x0;
    if (P.image && !cut) {
      T.img(P.n, L.x0, top, T.gw(6), IMG_H, P.image, { tag: R_("image"), contain: true });
      top += IMG_H + 8;
    }
    if (P.title) {
      T.text(P.n, headX, top, T.gw(4), 20,
        [{ t: P.title, fam: F.disp, face: FACE.dispReg, size: 26, color: INK }],
        { tag: R_("title"), lead: 28 });
      top += 22;
    }
    // The shortest frame that holds the runs, so a two-line pull is not set in
    // a six-line box with the empty half counted as its weight.
    function snug(x, y, w, runs, lead, max) {
      for (var h = lead + 2; h < max; h += 3) {
        var probe = T.text(P.n, x, y, w, h, runs, { tag: "mag-probe", lead: lead });
        var over = T.overflows(probe);
        T.kill("mag-probe", [P.n]);
        if (!over) return h;
      }
      return max;
    }
    if (P.deck && P.variant === "big-deck") {
      // No picture to lead with: the standfirst becomes the page's one big thing.
      var bigRuns = [{ t: P.deck, fam: F.disp, face: FACE.dispIt, size: 20, color: INK }];
      var bigW = cut ? T.gw(4) : T.gw(6), bigH = snug(headX, top + 2, bigW, bigRuns, 24, 60);
      T.text(P.n, headX, top + 2, bigW, bigH, bigRuns, { tag: R_("pull"), lead: 24 });
      top += bigH + 8;
    } else if (P.deck) {
      T.text(P.n, headX, top, cut ? T.gw(4) : T.gw(5), 15,
        [{ t: P.deck, fam: F.cond, size: 12, color: INK }], { tag: R_("deck"), lead: 15 });
      top += 18;
    }
    if (P.pull && P.variant === "pull") {
      var pullRuns = [{ t: P.pull, fam: F.disp, face: FACE.dispIt, size: 22, color: FIELD }];
      var pullW = cut ? T.gw(4) : T.gw(5), pullH = snug(headX, top + 4, pullW, pullRuns, 26, 70);
      T.text(P.n, headX, top + 4, pullW, pullH, pullRuns, { tag: R_("pull"), lead: 26 });
      top += pullH + 10;
    }
    var colW = T.gw(3);
    var below = cut ? Math.max(top, cut.y + cut.h + 6) : top;
    var leftTop = cut && !L.recto ? below : top, rightTop = cut && L.recto ? below : top;
    pourBalanced([L.x0, L.x0 + colW + T.GUT], [leftTop, rightTop], colW, 266, P.items);
    folio();
  }

  globalThis.TK_RESULT = { page: P.n, warnings: log, cols: CTX.cols || null, variant: P.variant,
    built: P.blocks.length ? "blocks" : "type", grid: BUILT, measure: CTX.measure || null };
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
  const g = T.pg(${n}), MM = T.MM;
  // A page built from blocks is on the spec's grid, not the house one.
  const L = R.grid ? { x0: R.grid.x0, x1: R.grid.x1 } : T.live(${n});
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

  const texts = [], frames = [];
  const r1 = function (v) { return Math.round(v * 10) / 10; };
  nodes.forEach(function (node) {
    var b;
    try { b = box(node); } catch (e) { return; }
    // Only count what is actually on this page of the spread.
    if (b.x + b.w < -2 || b.x > 212) return;

    // The geometry the score reads for grid and hierarchy (page-score.ts G, H).
    var d = node.userDescription, role = d.indexOf(":") > 0 ? d.slice(d.indexOf(":") + 1) : "";
    // Strokes inside drawn art: the field they sit in is the frame.
    if (role === "art") return;
    // A tagged frame says what it is. lineBox alone is not enough: on 3.3 a
    // plain rectangle has one too, and the paper ground "overlapped" every frame.
    var isText = false;
    if (role) isText = ["title", "deck", "body", "pull", "folio", "figure", "kicker", "runhead", "wordmark", "notes", "dropcap", "bengali", "bengali-en", "wordbox", "wordbox-sound", "wordbox-text", "kicker-bn", "folio-bn"].indexOf(role) >= 0;
    else try { isText = !!node.lineBox; } catch (e) {}
    frames.push({ role: role, text: isText, x: r1(b.x), y: r1(b.y), w: r1(b.w), h: r1(b.h) });

    if (isText) {
      texts.push({ node: node, b: b });
      var over = false; try { over = T.overflows(node); } catch (e) { /* Bengali outlines: no line box, nothing to overset */ }
      if (over) findings.push({ level: "error", what: "text frame oversets", at: Math.round(b.y) });
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
      // 10 mm² is a deck's last line sitting on the body's first; under that is a touch.
      if (a > 10) findings.push({ level: "error", what: "two text frames overlap", area: Math.round(a),
        roles: [texts[i].node.userDescription, texts[j].node.userDescription] });
    }
  }

  // Words the body could not hold are not on the page: the story stops mid-sentence.
  if (R.cols && R.cols.overset > 0) {
    findings.push({ level: "error", what: "the body oversets " + R.cols.overset + " words", roles: ["mag-p${n}:body"] });
  }

  R.findings = findings;
  R.frames = frames;
  if (!R.grid) R.grid = { x0: L.x0, x1: L.x1, top: T.bl(0), foot: 266, col: T.COLW, gut: T.GUT, ncol: T.NCOL };
  R.errors = findings.filter(function (f) { return f.level === "error"; }).length;
  R.nodes = nodes.length;
  console.log(JSON.stringify(R));
})();`;
