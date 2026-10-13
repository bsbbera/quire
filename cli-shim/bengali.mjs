// Bengali for Affinity. Affinity 3.3 does not shape Indic scripts (vowel signs land after their
// consonant, dotted circles appear), so a string with Bengali in it is shaped here with HarfBuzz
// (assets/harfbuzzjs) in the brand's own font files, and handed to tk.js as outlines.
//
// Words are shaped one by one at 10 pt and wrapped in Affinity (tk.js `bn`), because the size a
// block is set at is only decided there. Output per string:
//   { words: [{ d, w }], sp }   d = absolute M L C Z in mm, pen at 0, baseline y = 0, y down
// Ported from Output/Brand/ochin-01/build/shape.mjs, which built Ochin 01 this way.
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
let hbP = null;
const hb = () => (hbP ??= require(join(HERE, "assets", "harfbuzzjs", "index.js")));

export const BENGALI = /[ঀ-৿]/;

/** core/brands/<id>, staged (prod) or in the checkout (dev). */
export function brandDir(id) {
  for (const root of [join(HERE, "engine", "node_modules", "@actalk", "quire-core", "brands"), join(HERE, "..", "vendor", "studio", "packages", "core", "brands")]) {
    const d = join(root, String(id || ""));
    if (id && existsSync(join(d, "brand.json"))) return d;
  }
  return null;
}

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

const r3 = (v) => Math.round(v * 1000) / 1000;

/** One word's outline at 10 pt, quadratics raised to cubics (Affinity's CurveBuilder has none). */
async function word(file, wght, s) {
  const h = await hb(), { font, upem } = await fontOf(file, wght), mm = (10 * 25.4) / 72 / upem;
  const buf = h.createBuffer(); buf.addText(s); buf.guessSegmentProperties();
  h.shape(font, buf);
  const gl = buf.json(); buf.destroy();
  let pen = 0, d = "";
  for (const g of gl) {
    const t = font.glyphToPath(g.g).match(/[MLQCZ]|-?[\d.]+/g) || [];
    const X = (v) => r3(pen + g.dx * mm + v * mm), Y = (v) => r3(-g.dy * mm - v * mm);
    let i = 0, px = 0, py = 0; const n = () => +t[i++];
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
    pen += g.ax * mm;
  }
  return { d: d.trim(), w: r3(pen) };
}

/**
 * Shape every string under the brand's face for its role.
 * face: "mark" | "display" | "displayItalic" | "text"; wght for the variable text face.
 * Returns { [string]: { face, words, sp } }; strings without Bengali are left out.
 */
export async function shapeBengali(brandId, items) {
  const dir = brandDir(brandId);
  if (!dir) return {};
  const brand = JSON.parse(readFileSync(join(dir, "brand.json"), "utf-8"));
  const out = {};
  for (const { text, face = "display", wght } of items) {
    const s = String(text || "").trim();
    if (!s || !BENGALI.test(s) || out[s + "|" + face]) continue;
    const file = join(dir, "fonts", brand.type.files[face] || brand.type.files.display);
    if (!existsSync(file)) continue;
    const words = [];
    for (const w of s.split(/\s+/).filter(Boolean)) words.push(await word(file, wght, w));
    const sp = (await word(file, wght, "অ অ")).w - 2 * (await word(file, wght, "অ")).w;
    out[s + "|" + face] = { face, words, sp: r3(Math.max(0.6, sp)) };
  }
  return out;
}
