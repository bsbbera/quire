// Text for an authored spread (core spread-author.ts). A designer writes a spread as a script
// against the brand's kit (brands/<id>/author/lib.js) and names its text blocks; every block is
// shaped here first, in the brand's own font files, so the script can place by measured size
// (K.size(id)) the way Ochin 01 was built.
//   English: measured with HarfBuzz and set live in Affinity, broken where it was measured.
//   Bengali (any Bengali letter in the block): outlines, because Affinity 3.3 cannot shape it.
// Ported from Output/Brand/ochin-01/build/shape.mjs.
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { BENGALI, brandDir } from "./bengali.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
let hbP = null;
const hb = () => (hbP ??= require(join(HERE, "assets", "harfbuzzjs", "index.js")));
const r3 = (v) => Math.round(v * 1000) / 1000;
const MM = 25.4 / 72;

// role -> face, weight, caps, tracking (em). Sizes come from the brand's ladder.
const ROLES = {
  N1: { face: "mark" }, N2: { face: "mark", ladder: [44, 44] }, Y: { face: "mark", ladder: [30, 30] },
  D1: { face: "display" }, D2: { face: "display" }, D3: { face: "display" }, D4: { face: "display" },
  pull: { face: "display" },
  deck: { face: "text", wght: 300 }, body: { face: "text", wght: 400, para: 6 },
  chip: { face: "text", wght: 400 }, cap: { face: "text", wght: 400 },
  label: { face: "text", wght: 600, caps: true, track: 0.12 },
};
const TRAIT = { 300: "Light", 400: "Regular", 500: "Medium", 600: "SemiBold", 700: "Bold" };

const fonts = new Map();
async function fontOf(file, wght) {
  const key = file + "|" + (wght || "");
  if (fonts.has(key)) return fonts.get(key);
  const h = await hb();
  const face = h.createFace(h.createBlob(readFileSync(file)), 0), font = h.createFont(face);
  if (wght && font.setVariations) font.setVariations({ wght });
  const out = { font, upem: face.upem };
  fonts.set(key, out);
  return out;
}

async function shape(file, wght, pt, s) {
  const h = await hb(), { font, upem } = await fontOf(file, wght), mm = (pt * MM) / upem;
  const buf = h.createBuffer(); buf.addText(s); buf.guessSegmentProperties();
  h.shape(font, buf);
  const gl = buf.json().map((g) => ({ g: g.g, ax: g.ax * mm, dx: g.dx * mm, dy: g.dy * mm }));
  buf.destroy();
  return { font, mm, gl, w: gl.reduce((a, g) => a + g.ax, 0) };
}

function outline(font, mm, g, x0) {
  const t = font.glyphToPath(g.g).match(/[MLQCZ]|-?[\d.]+/g) || [];
  const X = (v) => r3(x0 + g.dx + v * mm), Y = (v) => r3(-g.dy - v * mm);
  let i = 0, px = 0, py = 0, d = ""; const n = () => +t[i++];
  while (i < t.length) {
    const c = t[i++];
    if (c === "M" || c === "L") { px = n(); py = n(); d += `${c}${X(px)} ${Y(py)} `; }
    else if (c === "Q") {
      const qx = n(), qy = n(), ex = n(), ey = n();
      d += `C${X(px + (2 / 3) * (qx - px))} ${Y(py + (2 / 3) * (qy - py))} ${X(ex + (2 / 3) * (qx - ex))} ${Y(ey + (2 / 3) * (qy - ey))} ${X(ex)} ${Y(ey)} `;
      px = ex; py = ey;
    } else if (c === "C") { const a = [n(), n(), n(), n(), n(), n()]; d += `C${X(a[0])} ${Y(a[1])} ${X(a[2])} ${Y(a[3])} ${X(a[4])} ${Y(a[5])} `; px = a[4]; py = a[5]; }
    else if (c === "Z") d += "Z ";
  }
  return d;
}

/** One block. item = { role, text, width?, align?, ital?, pt?, lead? } */
async function setBlock(dir, brand, item) {
  const role = ROLES[item.role] || ROLES.body;
  const [lp, ll] = role.ladder || brand.type.ladder[item.role] || brand.type.ladder.body;
  const pt = Number(item.pt) || lp, leadPt = Number(item.lead) || (item.pt ? Number(item.pt) * ll / lp : ll);
  const faceKey = role.face === "display" && item.ital ? "displayItalic" : role.face;
  const file = join(dir, "fonts", brand.type.files[faceKey]);
  if (!existsSync(file)) throw new Error(`the brand has no font file for ${faceKey}`);
  const wght = role.wght;
  const raw = String(item.text ?? "");
  const bengali = BENGALI.test(raw);
  const caps = role.caps && !bengali, track = caps ? role.track : 0;
  const text = caps ? raw.toUpperCase() : raw;
  const width = Number(item.width) || 0, align = item.align || "left";
  const lead = leadPt * MM, space = (await shape(file, wght, pt, " ")).w;
  const wOf = async (s) => { const r = await shape(file, wght, pt, s); return r.w + (track ? [...s].length * track * pt * MM : 0); };

  // break at spaces only: a Bengali word is a run of whole clusters, so no conjunct is ever split
  const rows = []; let gapY = 0;
  const paras = text.split("\n");
  for (let p = 0; p < paras.length; p++) {
    const words = paras[p].split(/ +/).filter(Boolean);
    if (p > 0) gapY += (role.para || 0) * MM;
    const ws = []; for (const w of words) ws.push(await wOf(w));
    let row = [], rw = 0;
    const flush = () => { rows.push({ words: row.map((i) => words[i]), w: rw + Math.max(0, row.length - 1) * space, y: r3(rows.length * lead + gapY), para: p }); row = []; rw = 0; };
    if (!words.length) { rows.push({ words: [], w: 0, y: r3(rows.length * lead + gapY), para: p }); continue; }
    words.forEach((_, i) => {
      if (width && row.length && rw + row.length * space + ws[i] > width) flush();
      row.push(i); rw += ws[i];
    });
    if (row.length) flush();
  }
  const w = width || Math.max(0, ...rows.map((r) => r.w));
  const h = r3((rows.length - 1) * lead + gapY + pt * MM * 1.05);
  const base = { pt, leadPt, lead: r3(lead), w: r3(w), h, align, role: item.role };

  if (!bengali) {
    const runs = paras.map((t, i) => ({ t: caps ? raw.split("\n")[i] : t, para: i ? role.para || 0 : 0 }));
    return { ...base, latin: true, fam: brand.type[role.face === "mark" ? "mark" : role.face === "display" ? "display" : "text"],
      trait: wght ? TRAIT[wght] : (item.ital ? "Italic" : "Regular"), ital: !!item.ital, caps, track, runs,
      lines: rows.map((r) => ({ w: r3(r.w), y: r.y })) };
  }
  // Bengali: one outline per line, the line's alignment inside the block baked in
  const lines = [];
  for (const r of rows) {
    const x0 = align === "right" ? w - r.w : align === "centre" ? (w - r.w) / 2 : 0;
    let x = x0, d = "";
    for (let j = 0; j < r.words.length; j++) {
      const s = await shape(file, wght, pt, r.words[j]);
      for (const g of s.gl) { d += outline(s.font, s.mm, g, x); x += g.ax; }
      if (j < r.words.length - 1) x += space;
    }
    lines.push({ d: d.trim(), w: r3(x - x0), y: r.y });
  }
  return { ...base, lines };
}

/** Shape every block of a spread. texts = { id: item }. Returns { blocks, errors }. */
export async function shapeTexts(brandId, texts) {
  const dir = brandDir(brandId);
  if (!dir) throw new Error(`no brand named ${brandId}`);
  const brand = JSON.parse(readFileSync(join(dir, "brand.json"), "utf-8"));
  const blocks = {}, errors = [];
  for (const [id, item] of Object.entries(texts || {})) {
    try { blocks[id] = await setBlock(dir, brand, item || {}); }
    catch (e) { errors.push(`${id}: ${e.message}`); }
  }
  return { blocks, errors };
}

/** What a script may know of its blocks before it runs: sizes only, no outlines. */
export const sizesOf = (blocks) => Object.fromEntries(Object.entries(blocks).map(([id, b]) => [id, { w: b.w, h: b.h, lines: b.lines.length, lead: b.lead }]));
