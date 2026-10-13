// What a rendered page and a placed picture measure (design-skill §12b, 09 §0.3b).
//
// Numbers only. Turning them into a score, a cause and a fix is core's job
// (`page-score.ts`); this file answers "what is on the page", from pixels, with
// no model. Pure Node over the PNG codec the post-processor already has, so
// nothing has to be installed to use it.
import { readFileSync } from "node:fs";
import { decode } from "./postprocess.mjs";

/** sRGB 0-255 → OKLab. ΔE_OK between two is plain Euclidean distance. */
export function oklab(r, g, b) {
  const lin = (v) => { const c = v / 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
  const R = lin(r), G = lin(g), B = lin(b);
  const l = Math.cbrt(0.4122214708 * R + 0.5363325363 * G + 0.0514459929 * B);
  const m = Math.cbrt(0.2119034982 * R + 0.6806995451 * G + 0.1073969566 * B);
  const s = Math.cbrt(0.0883024619 * R + 0.2817188376 * G + 0.6299787005 * B);
  return [
    0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s,
  ];
}

export const hexRgb = (hex) => {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(String(hex ?? "").trim());
  return m ? [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)] : null;
};

const dist = (p, q) => Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
const ROLES = ["paper", "ink", "hue", "field", "accent", "second", "third"];
/** Past this ΔE_OK from every declared colour a pixel is "off palette" (design-skill §12b, C). */
export const OFF_PALETTE = 0.12;
/** A cell is empty when nearly all of it is paper. */
const EMPTY_CELL = 0.98;
const CELL = 16;

/**
 * Measure one rendered page.
 *
 * `frames` are the image frames as fractions of the page ({x, y, w, h}, 0-1):
 * colour is measured outside them, because a picture is allowed any colour, and
 * they count as filled when weighing balance and whitespace.
 *
 * Returns, for the page outside its frames: the share of each declared colour
 * (nearest-role in OKLab), the share that matches none, the whitespace ratio
 * (cells that are all paper, of the whole page) and the balance (distance of the
 * weight centroid from the optical centre, as a fraction of the half-diagonal).
 */
export function measureRender(img, { palette = {}, frames = [], boxes = [] } = {}) {
  const { width: w, height: h, data } = img;
  const roles = ROLES.filter((r) => hexRgb(palette[r])).map((r) => ({ role: r, lab: oklab(...hexRgb(palette[r])) }));
  if (!roles.length) throw new Error("palette needs at least paper and ink as #rrggbb");
  const paper = roles.find((r) => r.role === "paper");

  const inFrame = (x, y) => frames.some((f) => x >= f.x * w && x < (f.x + f.w) * w && y >= f.y * h && y < (f.y + f.h) * h);
  const counts = Object.fromEntries(roles.map((r) => [r.role, 0]));
  let off = 0, pageCells = 0, emptyCells = 0, counted = 0;
  let wx = 0, wy = 0, weight = 0;

  const cellsX = Math.ceil(w / CELL), cellsY = Math.ceil(h / CELL);
  const paperPx = new Uint32Array(cellsX * cellsY), allPx = new Uint32Array(cellsX * cellsY), framed = new Uint8Array(cellsX * cellsY);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const cell = Math.floor(y / CELL) * cellsX + Math.floor(x / CELL);
      allPx[cell]++;
      if (inFrame(x, y)) { framed[cell] = 1; wx += x; wy += y; weight += 1; continue; }
      const o = (y * w + x) * 4;
      const a = data[o + 3] / 255;
      // Over white, as a printed page is: a transparent pixel is paper.
      const lab = oklab(data[o] * a + 255 * (1 - a), data[o + 1] * a + 255 * (1 - a), data[o + 2] * a + 255 * (1 - a));
      let best = roles[0], bestD = dist(lab, roles[0].lab);
      for (let i = 1; i < roles.length; i++) { const d = dist(lab, roles[i].lab); if (d < bestD) { best = roles[i]; bestD = d; } }
      counted++;
      if (bestD > OFF_PALETTE) off++; else counts[best.role]++;
      if (paper && best.role === "paper" && bestD <= 0.04) paperPx[cell]++;
      else { wx += x; wy += y; weight += 1; }
    }
  }
  for (let c = 0; c < allPx.length; c++) {
    pageCells++;
    if (!framed[c] && paperPx[c] >= EMPTY_CELL * allPx[c]) emptyCells++;
  }

  const share = Object.fromEntries(roles.map((r) => [r.role, counted ? counts[r.role] / counted : 0]));
  // Visual weight per laid frame (design-skill §12b H): its area in mm² times
  // its mean contrast against the paper, sampled every 3px. A picture weighs
  // nearly its area; a column of body text a fraction of it.
  const paperLab = paper ? paper.lab : oklab(255, 255, 255);
  const weights = boxes.map((b) => {
    const x0 = Math.max(0, Math.floor(b.x * w)), x1 = Math.min(w, Math.ceil((b.x + b.w) * w));
    const y0 = Math.max(0, Math.floor(b.y * h)), y1 = Math.min(h, Math.ceil((b.y + b.h) * h));
    let sum = 0, n = 0;
    for (let y = y0; y < y1; y += 3) for (let x = x0; x < x1; x += 3) {
      const o = (y * w + x) * 4, a = data[o + 3] / 255;
      const lab = oklab(data[o] * a + 255 * (1 - a), data[o + 1] * a + 255 * (1 - a), data[o + 2] * a + 255 * (1 - a));
      sum += Math.min(1, dist(lab, paperLab) / 0.5); n++;
    }
    return { role: b.role, weight: Math.round((n ? sum / n : 0) * b.w * 210 * b.h * 297) };
  });
  const cx = weight ? wx / weight : w / 2, cy = weight ? wy / weight : h * 0.45;
  const half = Math.hypot(w, h) / 2;
  return {
    px: [w, h],
    shares: share,
    offPalette: counted ? off / counted : 0,
    whitespace: pageCells ? emptyCells / pageCells : 0,
    balance: Math.hypot(cx - w / 2, cy - h * 0.45) / half,
    // Signed, so the cause line can say which way the page leans.
    lean: { x: (cx - w / 2) / w, y: (cy - h * 0.45) / h },
    ...(boxes.length ? { weights } : {}),
  };
}

/**
 * Check one placed picture before it reaches layout (asset-check, I).
 *
 * `slotMm` is the frame's size on the page, for the resolution it must carry;
 * `palette` the world's colours, for how far the picture's own colour sits from
 * them. A cutout is judged on how much of its frame the subject fills and on
 * stray half-transparent pixels away from the edge (a halo from a bad cut).
 */
export function assetCheck(img, { palette = {}, slotMm } = {}) {
  const { width: w, height: h, data } = img;
  let minX = w, minY = h, maxX = -1, maxY = -1, transparent = 0, partial = 0, halo = 0;
  const solid = (x, y) => x >= 0 && y >= 0 && x < w && y < h && data[(y * w + x) * 4 + 3] >= 248;
  let l = 0, a = 0, b = 0, n = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const o = (y * w + x) * 4;
      const al = data[o + 3];
      if (al < 16) { transparent++; continue; }
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (y < minY) minY = y; if (y > maxY) maxY = y;
      if (al < 248) {
        partial++;
        // Partial alpha is the edge's soft fall-off unless nothing solid is within 2px of it.
        let near = false;
        for (let dy = -2; dy <= 2 && !near; dy++) for (let dx = -2; dx <= 2; dx++) if (solid(x + dx, y + dy)) { near = true; break; }
        if (!near) halo++;
      }
      const lab = oklab(data[o], data[o + 1], data[o + 2]);
      l += lab[0]; a += lab[1]; b += lab[2]; n++;
    }
  }
  const box = maxX < 0 ? null : { x: minX / w, y: minY / h, w: (maxX - minX + 1) / w, h: (maxY - minY + 1) / h };
  const mean = n ? [l / n, a / n, b / n] : null;
  const colours = ["paper", "ink", "hue", "field"].map((r) => hexRgb(palette[r])).filter(Boolean).map((rgb) => oklab(...rgb));
  return {
    px: [w, h],
    hasAlpha: transparent > 0 || partial > 0,
    subjectBox: box,
    // Share of the frame the subject's bounding box covers.
    fill: box ? box.w * box.h : 0,
    haloShare: partial ? halo / partial : 0,
    deltaE: mean && colours.length ? Math.min(...colours.map((c) => dist(mean, c))) : null,
    ...(slotMm ? { dpi: Math.round(w / (slotMm[0] / 25.4)) } : {}),
  };
}

export const measureFile = (file, opts) => measureRender(decode(readFileSync(file)), opts);
export const assetFile = (file, opts) => assetCheck(decode(readFileSync(file)), opts);
