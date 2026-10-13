// What happens to a picture after it is rendered (09 §1, route A).
//
// A cutout, a vignette, a painted edge, a duotone: every one of these is a
// compositing job, not a model's, and doing them on the file the render just
// wrote is what lets a book's pictures sit on the page in more than one way
// without training anything. Pure Node — a PNG codec over zlib and a handful
// of pixel loops — so nothing has to be installed to use it.
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { deflateSync, inflateSync } from "node:zlib";

const SIG = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const CHANNELS = { 0: 1, 2: 3, 4: 2, 6: 4 };

/** PNG → { width, height, data: RGBA }. 8-bit, non-interlaced: what ComfyUI writes. */
export function decode(buf) {
  if (!buf.subarray(0, 8).equals(SIG)) throw new Error("not a PNG");
  let pos = 8, w = 0, h = 0, depth = 0, ctype = 0, interlace = 0;
  const idat = [];
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString("ascii", pos + 4, pos + 8);
    const data = buf.subarray(pos + 8, pos + 8 + len);
    if (type === "IHDR") {
      w = data.readUInt32BE(0); h = data.readUInt32BE(4);
      depth = data[8]; ctype = data[9]; interlace = data[12];
    } else if (type === "IDAT") idat.push(data);
    else if (type === "IEND") break;
    pos += 12 + len;
  }
  const ch = CHANNELS[ctype];
  if (depth !== 8 || interlace !== 0 || !ch) {
    throw new Error(`unsupported PNG (bit depth ${depth}, colour type ${ctype}, interlace ${interlace})`);
  }
  const raw = inflateSync(Buffer.concat(idat));
  const stride = w * ch;
  const out = Buffer.alloc(w * h * 4);
  let prev = Buffer.alloc(stride), cur = Buffer.alloc(stride);
  for (let y = 0; y < h; y++) {
    const row = y * (stride + 1);
    const f = raw[row];
    for (let x = 0; x < stride; x++) {
      const a = x >= ch ? cur[x - ch] : 0, b = prev[x], c = x >= ch ? prev[x - ch] : 0;
      let v = raw[row + 1 + x];
      if (f === 1) v += a;
      else if (f === 2) v += b;
      else if (f === 3) v += (a + b) >> 1;
      else if (f === 4) {
        const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      cur[x] = v & 255;
    }
    for (let x = 0; x < w; x++) {
      const o = (y * w + x) * 4, i = x * ch;
      if (ch >= 3) {
        out[o] = cur[i]; out[o + 1] = cur[i + 1]; out[o + 2] = cur[i + 2];
        out[o + 3] = ch === 4 ? cur[i + 3] : 255;
      } else {
        out[o] = out[o + 1] = out[o + 2] = cur[i];
        out[o + 3] = ch === 2 ? cur[i + 1] : 255;
      }
    }
    [prev, cur] = [cur, prev];
  }
  return { width: w, height: h, data: out };
}

const CRC = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC[(c ^ buf[i]) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const head = Buffer.alloc(4); head.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const tail = Buffer.alloc(4); tail.writeUInt32BE(crc32(body));
  return Buffer.concat([head, body, tail]);
}

/** RGBA → PNG, "sub" filter on every row: small enough, and simple. */
export function encode({ width, height, data }) {
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    const row = y * (stride + 1), src = y * stride;
    raw[row] = 1;
    for (let x = 0; x < stride; x++) raw[row + 1 + x] = (data[src + x] - (x >= 4 ? data[src + x - 4] : 0)) & 255;
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([SIG, chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw, { level: 6 })), chunk("IEND", Buffer.alloc(0))]);
}

/* --------------------------------------------------------------- helpers */
const clamp = (v) => (v < 0 ? 0 : v > 255 ? 255 : v);
const smooth = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const rgbOf = (hex) => [1, 3, 5].map((i) => parseInt(String(hex).slice(i, i + 2), 16) || 0);
const lum = (d, o) => 0.2126 * d[o] + 0.7152 * d[o + 1] + 0.0722 * d[o + 2];

function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Smooth value noise, 0..1, `cells` across; wrapping so a tile has no seam. */
function noise(w, h, cells, seed) {
  const gx = Math.max(1, cells), gy = Math.max(1, Math.round(cells * h / w));
  const r = rng(seed);
  const grid = new Float32Array((gx + 1) * (gy + 1));
  for (let y = 0; y < gy; y++) for (let x = 0; x < gx; x++) grid[y * (gx + 1) + x] = r();
  for (let y = 0; y <= gy; y++) grid[y * (gx + 1) + gx] = grid[(y % gy) * (gx + 1)];
  for (let x = 0; x <= gx; x++) grid[gy * (gx + 1) + x] = grid[x % (gx + 1)];
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    const fy = (y / h) * gy, y0 = Math.floor(fy), ty = fy - y0, sy = ty * ty * (3 - 2 * ty);
    for (let x = 0; x < w; x++) {
      const fx = (x / w) * gx, x0 = Math.floor(fx), tx = fx - x0, sx = tx * tx * (3 - 2 * tx);
      const i = y0 * (gx + 1) + x0;
      const a = grid[i], b = grid[i + 1], c = grid[i + gx + 1], d = grid[i + gx + 2];
      out[y * w + x] = a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
    }
  }
  return out;
}

function scaleAlpha(img, factor) {
  const { width: w, height: h, data } = img;
  for (let i = 0; i < w * h; i++) data[i * 4 + 3] = Math.round(data[i * 4 + 3] * factor(i % w, (i - (i % w)) / w, i));
}

/** An irregular painted or torn edge: distance to the border, pushed around by noise. */
function edge(img, { width = 0.14, coarse = 14, fine = 48, amount = 0.9, hard = false, seed = 11 }) {
  const { width: w, height: h } = img;
  const n1 = noise(w, h, coarse, seed), n2 = noise(w, h, fine, seed + 1);
  const m = Math.min(w, h) * width;
  scaleAlpha(img, (x, y, i) => {
    const d = Math.min(x, w - 1 - x, y, h - 1 - y) / m + (n1[i] - 0.5) * amount + (n2[i] - 0.5) * amount * 0.4;
    return hard ? (d > 0.6 ? 1 : 0) : smooth(0.25, 0.95, d);
  });
}

/* ------------------------------------------------------- cutout helpers */
/** A separable box blur of the rgb channels, as floats. */
function boxBlur(data, w, h, r) {
  const out = new Float32Array(w * h * 3), tmp = new Float32Array(w * h * 3), d = 2 * r + 1;
  for (let y = 0; y < h; y++) for (let k = 0; k < 3; k++) {
    const row = y * w;
    let s = 0;
    for (let x = -r; x <= r; x++) s += data[(row + Math.min(w - 1, Math.max(0, x))) * 4 + k];
    for (let x = 0; x < w; x++) {
      tmp[(row + x) * 3 + k] = s / d;
      s += data[(row + Math.min(w - 1, x + r + 1)) * 4 + k] - data[(row + Math.max(0, x - r)) * 4 + k];
    }
  }
  for (let x = 0; x < w; x++) for (let k = 0; k < 3; k++) {
    let s = 0;
    for (let y = -r; y <= r; y++) s += tmp[(Math.min(h - 1, Math.max(0, y)) * w + x) * 3 + k];
    for (let y = 0; y < h; y++) {
      out[(y * w + x) * 3 + k] = s / d;
      s += tmp[(Math.min(h - 1, y + r + 1) * w + x) * 3 + k] - tmp[(Math.max(0, y - r) * w + x) * 3 + k];
    }
  }
  return out;
}

const fieldTerms = (i, w, h) => { const x = (i % w) / w - 0.5, y = Math.floor(i / w) / h - 0.5; return [1, x, y, x * x, x * y, y * y]; };

/** Least squares: a quadratic surface per channel through the given pixels. */
function fitField(blur, w, h, pts) {
  return [0, 1, 2].map((k) => {
    const A = Array.from({ length: 6 }, () => new Array(7).fill(0));
    for (const i of pts) {
      const t = fieldTerms(i, w, h), v = blur[i * 3 + k];
      for (let r = 0; r < 6; r++) { for (let c = 0; c < 6; c++) A[r][c] += t[r] * t[c]; A[r][6] += t[r] * v; }
    }
    for (let c = 0; c < 6; c++) {
      let p = c;
      for (let r = c + 1; r < 6; r++) if (Math.abs(A[r][c]) > Math.abs(A[p][c])) p = r;
      [A[c], A[p]] = [A[p], A[c]];
      if (Math.abs(A[c][c]) < 1e-9) continue;
      for (let r = 0; r < 6; r++) if (r !== c) { const f = A[r][c] / A[c][c]; for (let q = c; q < 7; q++) A[r][q] -= f * A[c][q]; }
    }
    return A.map((row, c) => (Math.abs(row[c]) < 1e-9 ? 0 : row[6] / row[c]));
  });
}

function fieldAt(cf, w, h, i) { const t = fieldTerms(i, w, h); return cf.map((co) => co.reduce((s, v, j) => s + v * t[j], 0)); }

function offField(cf, blur, w, h, i) {
  const m = fieldAt(cf, w, h, i);
  return Math.max(Math.abs(blur[i * 3] - m[0]), Math.abs(blur[i * 3 + 1] - m[1]), Math.abs(blur[i * 3 + 2] - m[2]));
}

/** Foreground islands smaller than `min` pixels become ground. */
function dropSpecks(bg, w, h, min) {
  const n = w * h, seen = new Uint8Array(n);
  for (let s0 = 0; s0 < n; s0++) {
    if (bg[s0] || seen[s0]) continue;
    const comp = [s0]; seen[s0] = 1;
    for (let c = 0; c < comp.length; c++) {
      const i = comp[c], x = i % w;
      if (x > 0 && !bg[i - 1] && !seen[i - 1]) { seen[i - 1] = 1; comp.push(i - 1); }
      if (x < w - 1 && !bg[i + 1] && !seen[i + 1]) { seen[i + 1] = 1; comp.push(i + 1); }
      if (i >= w && !bg[i - w] && !seen[i - w]) { seen[i - w] = 1; comp.push(i - w); }
      if (i < n - w && !bg[i + w] && !seen[i + w]) { seen[i + w] = 1; comp.push(i + w); }
    }
    if (comp.length < min) for (const i of comp) bg[i] = 1;
  }
}

/** Ground not reached from the border, in islands under `max` pixels, becomes subject. */
function fillHoles(bg, w, h, max) {
  const n = w * h, reach = new Uint8Array(n), stack = [];
  const go = (i) => { if (bg[i] && !reach[i]) { reach[i] = 1; stack.push(i); } };
  for (let x = 0; x < w; x++) { go(x); go((h - 1) * w + x); }
  for (let y = 0; y < h; y++) { go(y * w); go(y * w + w - 1); }
  while (stack.length) {
    const i = stack.pop(), x = i % w;
    if (x > 0) go(i - 1);
    if (x < w - 1) go(i + 1);
    if (i >= w) go(i - w);
    if (i < n - w) go(i + w);
  }
  const seen = new Uint8Array(n);
  for (let s0 = 0; s0 < n; s0++) {
    if (!bg[s0] || reach[s0] || seen[s0]) continue;
    const comp = [s0]; seen[s0] = 1;
    for (let c = 0; c < comp.length; c++) {
      const i = comp[c], x = i % w;
      for (const j of [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, i >= w ? i - w : -1, i < n - w ? i + w : -1]) {
        if (j >= 0 && bg[j] && !reach[j] && !seen[j]) { seen[j] = 1; comp.push(j); }
      }
    }
    if (comp.length < max) for (const i of comp) bg[i] = 0;
  }
}

/** Grow the pixels equal to `val` by r (a square), separably. */
function grow(src, w, h, r, val) {
  const n = w * h, out = new Uint8Array(n), tmp = new Uint8Array(n);
  for (let y = 0; y < h; y++) {
    let last = -1e9;
    for (let x = 0; x < w; x++) { if (src[y * w + x] === val) last = x; tmp[y * w + x] = x - last <= r ? val : 1 - val; }
    last = 1e9;
    for (let x = w - 1; x >= 0; x--) { if (src[y * w + x] === val) last = x; if (last - x <= r) tmp[y * w + x] = val; }
  }
  for (let x = 0; x < w; x++) {
    let last = -1e9;
    for (let y = 0; y < h; y++) { if (tmp[y * w + x] === val) last = y; out[y * w + x] = y - last <= r ? val : 1 - val; }
    last = 1e9;
    for (let y = h - 1; y >= 0; y--) { if (tmp[y * w + x] === val) last = y; if (last - y <= r) out[y * w + x] = val; }
  }
  return out;
}

/* ------------------------------------------------------------------- ops */
/** "#rrggbb" as [r,g,b], or null for anything else — `rgbOf` above assumes a hex. */
function groundRgb(value) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(value ?? ""));
  if (!m) return null;
  const hex = m[1];
  return [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16));
}

/**
 * The ground as the picture actually painted it: the median of four corner
 * patches, and how much it varies there (paper grain, gouache texture), so the
 * key can be as wide as the ground is rough.
 */
function patchGround(data, w, h, size = 24) {
  const s = Math.max(1, Math.min(size, Math.floor(w / 8), Math.floor(h / 8)));
  const px = [];
  for (const [x0, y0] of [[0, 0], [w - s, 0], [0, h - s], [w - s, h - s]]) {
    for (let y = y0; y < y0 + s; y++) for (let x = x0; x < x0 + s; x++) {
      const o = (y * w + x) * 4; px.push([data[o], data[o + 1], data[o + 2]]);
    }
  }
  const rgb = [0, 1, 2].map((k) => { const v = px.map((p) => p[k]).sort((a, b) => a - b); return v[v.length >> 1]; });
  // The spread that holds 90 % of the ground's pixels around its median.
  const dev = px.map((p) => Math.max(...[0, 1, 2].map((k) => Math.abs(p[k] - rgb[k])))).sort((a, b) => a - b);
  return { rgb, spread: dev[Math.floor(dev.length * 0.9)] ?? 0 };
}

/** The ground colour as the picture reports it: the median of its four corners. */
function corner(data, w, h) {
  const at = (x, y) => { const o = (y * w + x) * 4; return [data[o], data[o + 1], data[o + 2]]; };
  const corners = [at(0, 0), at(w - 1, 0), at(0, h - 1), at(w - 1, h - 1)];
  return [0, 1, 2].map((k) => {
    const band = corners.map((c) => c[k]).sort((a, b) => a - b);
    return Math.round((band[1] + band[2]) / 2);
  });
}

export const OPS = {
  /**
   * Take the ground away and keep the subject whole.
   *
   * The ground is read as a smooth field: a quadratic surface fitted to the
   * picture's border on a lightly blurred copy, twice, dropping the border
   * pixels where the subject touches the edge. A pixel is ground when it sits
   * as close to that field as the ground sits to itself, and is reached from the
   * border. Blurring first is what lets a grainy painted ground key at all; the
   * fitted field is what keys a ground that darkens toward the edges without
   * eating a pale subject (an ivory casque on cream). Specks the fill went round
   * are dropped, narrow bites into the subject are closed, and the edge is
   * softened one pixel and de-fringed against the field.
   * ponytail: a fitted-ground key, not a segmentation model - a subject the
   * colour of its ground with no edge between them still loses that part.
   * Upgrade: a BiRefNet/RMBG workflow in Comfy (its models folder is empty).
   */
  cutout(img, { radius = 3, speck = 0.0004, close = 0.006 } = {}) {
    const { width: w, height: h, data } = img;
    const n = w * h;
    const blur = boxBlur(data, w, h, radius);
    const border = [];
    for (let x = 0; x < w; x += 2) border.push(x, (h - 1) * w + x, Math.min(h - 1, 2) * w + x, Math.max(0, h - 3) * w + x);
    for (let y = 0; y < h; y += 2) border.push(y * w, y * w + w - 1, y * w + Math.min(w - 1, 2), y * w + Math.max(0, w - 3));
    const off = (cf, i) => offField(cf, blur, w, h, i);
    let cf = fitField(blur, w, h, border), pts = border;
    for (let pass = 0; pass < 2; pass++) {
      const d = pts.map((i) => off(cf, i)).sort((a, b) => a - b), med = d[d.length >> 1];
      const kept = border.filter((i) => off(cf, i) <= Math.max(3, med * 2.5));
      if (kept.length < 12) break;
      pts = kept; cf = fitField(blur, w, h, pts);
    }
    const res = pts.map((i) => off(cf, i)).sort((a, b) => a - b);
    // As wide as the ground varies from its own field, and a little more.
    const tol = Math.max(6, (res[Math.floor(res.length * 0.95)] ?? 0) * 1.5 + 3);
    const bg = new Uint8Array(n);
    const stack = [];
    const push = (i) => { if (!bg[i] && off(cf, i) <= tol) { bg[i] = 1; stack.push(i); } };
    for (let x = 0; x < w; x++) { push(x); push((h - 1) * w + x); }
    for (let y = 0; y < h; y++) { push(y * w); push(y * w + w - 1); }
    while (stack.length) {
      const i = stack.pop(), x = i % w;
      if (x > 0) push(i - 1);
      if (x < w - 1) push(i + 1);
      if (i >= w) push(i - w);
      if (i < n - w) push(i + w);
    }
    // The blur widened the subject by its radius: walk the edge back in on the
    // sharp pixels, as far as the ground's own grain reaches.
    const raw = (i) => { const m = fieldAt(cf, w, h, i); return Math.max(Math.abs(data[i * 4] - m[0]), Math.abs(data[i * 4 + 1] - m[1]), Math.abs(data[i * 4 + 2] - m[2])); };
    for (let pass = 0; pass < radius; pass++) {
      const edgeIn = [];
      for (let i = 0; i < n; i++) {
        if (bg[i]) continue;
        const x = i % w;
        if ((x > 0 && bg[i - 1]) || (x < w - 1 && bg[i + 1]) || (i >= w && bg[i - w]) || (i < n - w && bg[i + w])) {
          if (raw(i) <= tol * 2) edgeIn.push(i);
        }
      }
      for (const i of edgeIn) bg[i] = 1;
    }
    dropSpecks(bg, w, h, Math.max(30, Math.round(n * speck)));
    // Grow the subject by r and shrink it back: only gaps narrower than 2r close.
    const r = Math.max(2, Math.round(Math.min(w, h) * close));
    const closed = grow(grow(bg, w, h, r, 0), w, h, r, 1);
    for (let i = 0; i < n; i++) bg[i] = bg[i] && closed[i] ? 1 : 0;
    // Closing a bite can leave the ground behind it enclosed in the subject: a pinhole that
    // shows whatever is drawn behind the picture (Birds p14's arch through the hornbill's neck).
    // Small enclosed ground is the subject's; a large one (a gap between two figures) stays open.
    fillHoles(bg, w, h, Math.round(n * 0.005));
    let removed = 0;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        if (bg[i]) removed += 1;
        let fg = 0, all = 0;
        for (let dy = -1; dy <= 1; dy++) {
          const yy = y + dy;
          if (yy < 0 || yy >= h) continue;
          for (let dx = -1; dx <= 1; dx++) {
            const xx = x + dx;
            if (xx < 0 || xx >= w) continue;
            all += 1;
            if (!bg[yy * w + xx]) fg += 1;
          }
        }
        const t = bg[i] ? 0 : fg / all;
        const o = i * 4;
        // De-fringe against the ground field at this pixel.
        if (t > 0 && t < 1) {
          const g = fieldAt(cf, w, h, i);
          for (let k = 0; k < 3; k++) data[o + k] = clamp(Math.round((data[o + k] - g[k] * (1 - t)) / t));
        }
        data[o + 3] = Math.round(data[o + 3] * t);
      }
    }
    const share = removed / n;
    const mid = fieldAt(cf, w, h, Math.floor(h / 2) * w + (w >> 1)).map((c) => clamp(Math.round(c)));
    return {
      removed: Math.round(share * 1000) / 1000,
      ground: `#${mid.map((c) => c.toString(16).padStart(2, "0")).join("")}`,
      ...(share < 0.02 ? { warning: "no flat ground found round the subject" } : {}),
    };
  },

  /**
   * Measure the painted ground: its colour where it meets the frame's edge
   * (what the page around it must match), its colour at the middle, and its
   * grain (how far its pixels stray from the smooth field), so Affinity can draw
   * shapes in the same colour and texture. Then ease the ground's tone to that
   * edge colour along every edge that does not cut the subject: a painted ground
   * lightens towards its middle, and the flat shape the plate sits in would show
   * where that ramp starts. Only the smoothed tone moves; the grain is kept and
   * the subject (tone far from the ground) is left alone.
   */
  ground(img, { radius = 3, ease = 0.45 } = {}) {
    const { width: w, height: h, data } = img;
    const blur = boxBlur(data, w, h, radius);
    const border = [];
    for (let x = 0; x < w; x += 2) border.push(x, (h - 1) * w + x);
    for (let y = 0; y < h; y += 2) border.push(y * w, y * w + w - 1);
    const off = (cf, i) => offField(cf, blur, w, h, i);
    let cf = fitField(blur, w, h, border), pts = border;
    for (let pass = 0; pass < 2; pass++) {
      const d = pts.map((i) => off(cf, i)).sort((a, b) => a - b), med = d[d.length >> 1];
      const kept = border.filter((i) => off(cf, i) <= Math.max(3, med * 2.5));
      if (kept.length < 12) break;
      pts = kept; cf = fitField(blur, w, h, pts);
    }
    const hex = (c) => `#${c.map((v) => clamp(Math.round(v)).toString(16).padStart(2, "0")).join("")}`;
    const edge = [0, 1, 2].map((k) => { const v = pts.map((i) => blur[i * 3 + k]).sort((a, b) => a - b); return v[v.length >> 1]; });
    // Grain: the spread of the sharp pixels about the field, on the ground.
    let sum = 0;
    for (const i of pts) { const m = fieldAt(cf, w, h, i); for (let k = 0; k < 3; k++) { const d = data[i * 4 + k] - m[k]; sum += d * d; } }
    const grain = Math.sqrt(sum / Math.max(1, pts.length * 3));
    // Where the subject is: the box of what stands off the ground (rows and columns with
    // more than a speck of it), and which edges of the picture cut it, so the page can
    // crop the plate to its subject and put a cut edge on the trim.
    const res = pts.map((i) => off(cf, i)).sort((a, b) => a - b);
    const tol = Math.max(6, (res[Math.floor(res.length * 0.95)] ?? 0) * 1.5 + 3);
    // The grain's two parts, as a print reproduces them: how far a pixel's brightness strays
    // from its neighbourhood, and how far its colour strays from that brightness. Painted
    // grounds out of the image model carry more of the second (coloured speckle) than the first.
    // Measured on a ring inside the border, on ground only, so a frame artefact is not grain.
    let L2 = 0, C2 = 0, nn = 0;
    const inset = Math.min(8, Math.floor(Math.min(w, h) / 10));
    for (const i of pts) {
      const x = Math.min(w - 1 - inset, Math.max(inset, i % w)), y = Math.min(h - 1 - inset, Math.max(inset, Math.floor(i / w)));
      const j = y * w + x;
      if (off(cf, j) > tol) continue;
      const d = [0, 1, 2].map((k) => data[j * 4 + k] - blur[j * 3 + k]), l = (d[0] + d[1] + d[2]) / 3;
      L2 += l * l; C2 += d.reduce((s, v) => s + (v - l) ** 2, 0) / 3; nn++;
    }
    const lumGrain = Math.round(Math.sqrt(L2 / Math.max(1, nn)) * 10) / 10, chromaGrain = Math.round(Math.sqrt(C2 / Math.max(1, nn)) * 10) / 10;
    const cols = new Uint32Array(w), rows = new Uint32Array(h);
    for (let y = 0; y < h; y += 2) for (let x = 0; x < w; x += 2) if (off(cf, y * w + x) > tol) { cols[x]++; rows[y]++; }
    const span = (a, n, min) => { let lo = 0, hi = n - 1; while (lo < n && a[lo] < min) lo++; while (hi > lo && a[hi] < min) hi--; return [lo, hi]; };
    const [x0, x1] = span(cols, w, Math.max(2, h / 2 * 0.01)), [y0, y1] = span(rows, h, Math.max(2, w / 2 * 0.01));
    const r3 = (v) => Math.round(v * 1000) / 1000;
    const subject = [r3(x0 / w), r3(y0 / h), r3((x1 + 1) / w), r3((y1 + 1) / h)];
    // An edge cuts the subject when the subject runs into it along a real length.
    const along = (list) => list.filter((v) => v > tol).length / Math.max(1, list.length);
    const edgeOff = (xs, ys) => along(xs.flatMap((x) => ys.map((y) => off(cf, y * w + x))));
    const every = (n) => Array.from({ length: Math.ceil(n / 4) }, (_, i) => i * 4).filter((v) => v < n);
    const cut = [
      ...(edgeOff([w - 2], every(h)) > 0.08 ? ["right"] : []), ...(edgeOff([1], every(h)) > 0.08 ? ["left"] : []),
      ...(edgeOff(every(w), [h - 2]) > 0.08 ? ["bottom"] : []), ...(edgeOff(every(w), [1]) > 0.08 ? ["top"] : []),
    ];
    if (ease > 0) {
      const m = Math.max(4, Math.round(Math.min(w, h) * ease)), R = Math.max(4, Math.round(Math.min(w, h) * 0.03));
      // The ground's tone round each pixel from ground pixels only (a masked blur), so the
      // subject's colour does not leak into it and leave a halo round the bird.
      const isGround = (i) => Math.max(...[0, 1, 2].map((k) => Math.abs(blur[i * 3 + k] - edge[k]))) < 45;
      const num = new Float32Array(w * h * 4), den = new Float32Array(w * h * 4);
      for (let i = 0; i < w * h; i++) if (isGround(i)) { for (let k = 0; k < 3; k++) num[i * 4 + k] = data[i * 4 + k]; den[i * 4] = 1; }
      const Bn = boxBlur(num, w, h, R), Bd = boxBlur(den, w, h, R);
      const B = new Float32Array(w * h * 3);
      for (let i = 0; i < w * h; i++) for (let k = 0; k < 3; k++) B[i * 3 + k] = Bd[i * 3] > 0.05 ? Bn[i * 3 + k] / Bd[i * 3] : edge[k];
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        const d = Math.min(cut.includes("left") ? Infinity : x, cut.includes("right") ? Infinity : w - 1 - x,
          cut.includes("top") ? Infinity : y, cut.includes("bottom") ? Infinity : h - 1 - y);
        if (d >= m) continue;
        const i = y * w + x, wt = 1 - smooth(0, 1, d / m);
        // Only the ground moves: a subject pixel keeps its colour.
        const far = Math.max(...[0, 1, 2].map((k) => Math.abs(blur[i * 3 + k] - B[i * 3 + k])));
        const g = 1 - smooth(12, 30, far);
        if (g <= 0) continue;
        for (let k = 0; k < 3; k++) data[i * 4 + k] = clamp(Math.round(data[i * 4 + k] + (edge[k] - B[i * 3 + k]) * wt * g));
      }
    }
    return { edge: hex(edge), ground: hex(fieldAt(cf, w, h, Math.floor(h / 2) * w + (w >> 1))), grain: Math.round(grain * 10) / 10, lum: lumGrain, chroma: chromaGrain, size: [w, h], subject, cut, removed: 0 };
  },

  /** Soft oval fade to nothing: the picture sits in the paper. */
  vignette(img) {
    const { width: w, height: h } = img;
    scaleAlpha(img, (x, y) => {
      const dx = ((x + 0.5) / w) * 2 - 1, dy = ((y + 0.5) / h) * 2 - 1;
      return 1 - smooth(0.62, 1.0, Math.sqrt(dx * dx + dy * dy));
    });
  },

  /** Painted edges bleeding into the paper. */
  "bleed-edge"(img) {
    edge(img, { width: 0.14, coarse: 14, fine: 48, amount: 0.9, seed: img.width * 7 + img.height });
  },

  /** Every tone mapped between the world's ink and its paper. */
  duotone(img, { dark = "#1d1b18", light = "#f4efe6" } = {}) {
    const D = rgbOf(dark), L = rgbOf(light), { data } = img;
    for (let o = 0; o < data.length; o += 4) {
      const t = lum(data, o) / 255;
      for (let k = 0; k < 3; k++) data[o + k] = Math.round(D[k] + (L[k] - D[k]) * t);
    }
  },

  /** One colour, the world's ink: an ornament a press could print. */
  "one-colour"(img, { ink = "#1d1b18" } = {}) {
    const I = rgbOf(ink), { data } = img;
    for (let o = 0; o < data.length; o += 4) {
      const a = clamp((255 - lum(data, o)) * 1.8);
      data[o] = I[0]; data[o + 1] = I[1]; data[o + 2] = I[2];
      data[o + 3] = Math.round((data[o + 3] * a) / 255);
    }
  },

  /** A texture faint enough to sit behind type. */
  wash(img, { opacity = 0.16 } = {}) {
    scaleAlpha(img, () => opacity);
  },

  /**
   * Seamless: the image offset by half, which puts its seams in the middle,
   * with the untouched middle of the original laid back over them.
   * ponytail: the classic offset-and-blend — a faint seam can survive near the
   * middle of each edge. Upgrade: a proper tiling workflow in Comfy.
   */
  tile(img) {
    const { width: w, height: h, data } = img;
    const src = Buffer.from(data);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const sx = (x + (w >> 1)) % w, sy = (y + (h >> 1)) % h;
        const dx = Math.abs(((x + 0.5) / w) * 2 - 1), dy = Math.abs(((y + 0.5) / h) * 2 - 1);
        const m = 1 - smooth(0.35, 0.8, Math.max(dx, dy));
        const o = (y * w + x) * 4, s = (sy * w + sx) * 4;
        for (let k = 0; k < 4; k++) data[o + k] = Math.round(src[o + k] * m + src[s + k] * (1 - m));
      }
    }
  },
};

/**
 * Run a treatment's ops on a picture, in place.
 *
 * The untouched render is kept beside it in a dot-folder the gallery does not
 * list, so switching treatment later starts from the original rather than from
 * a cutout of a vignette of it. `fresh` is a new render (its original is what is
 * on disk now); otherwise the kept original is the source, and an empty op list
 * puts it back.
 */
export function apply(file, ops = [], { fresh = true } = {}) {
  const list = (Array.isArray(ops) ? ops : []).filter((o) => o && OPS[o.op]);
  const raw = join(dirname(file), ".raw", basename(file));
  if (fresh) {
    if (!list.length) return { applied: [], raw: null };
    mkdirSync(dirname(raw), { recursive: true });
    copyFileSync(file, raw);
  } else if (!existsSync(raw)) {
    if (!list.length) return { applied: [], raw: null };
    mkdirSync(dirname(raw), { recursive: true });
    copyFileSync(file, raw);
  }
  if (!list.length) {
    copyFileSync(raw, file);
    return { applied: [], raw: `.raw/${basename(file)}` };
  }
  const img = decode(readFileSync(raw));
  const applied = list.map((o) => ({ ...o, ...(OPS[o.op](img, o) || {}) }));
  writeFileSync(file, encode(img));
  return { applied, raw: `.raw/${basename(file)}` };
}

/** A white sheet whose alpha is the mask: what Affinity lays over a picture. */
export function drawMask(kind, w = 512, h = 512) {
  const img = { width: w, height: h, data: Buffer.alloc(w * h * 4, 255) };
  if (kind === "vignette") OPS.vignette(img);
  else if (kind === "bleed") OPS["bleed-edge"](img);
  else if (kind === "torn-edge") edge(img, { width: 0.06, coarse: 40, fine: 160, amount: 1.1, hard: true, seed: 5 });
  else throw new Error("no mask called " + kind);
  return encode(img);
}

/** The world's paper as a seamless tile, a little grain in it. */
export function paperGrain(hex, size = 256, seed = 7) {
  const P = rgbOf(hex || "#f4efe6");
  const fine = noise(size, size, 64, seed), broad = noise(size, size, 8, seed + 1);
  const data = Buffer.alloc(size * size * 4);
  for (let i = 0; i < size * size; i++) {
    const v = (fine[i] - 0.5) * 16 + (broad[i] - 0.5) * 10;
    for (let k = 0; k < 3; k++) data[i * 4 + k] = clamp(Math.round(P[k] + v));
    data[i * 4 + 3] = 255;
  }
  return encode({ width: size, height: size, data });
}

/**
 * A colour with the painted ground's grain baked in: a small tile Affinity repeats
 * as a bitmap fill, so a drawn shape carries the same texture as the picture
 * beside it. `g` is the grain the picture measured (postprocess `ground`): `lum`,
 * the spread of brightness, and `chroma`, the spread of colour about it, both per
 * pixel and uncorrelated with the neighbour, as the picture's own are. The tile is
 * laid at the picture's own pixel size on the page, so one speckle matches another.
 */
export function colourGrain(hex, g, size = 512, seed = 5) {
  const P = rgbOf(hex || "#f4efe6");
  // An old recipe has one number: split it as the image model's grounds measured.
  const L = typeof g === "number" ? g * 0.45 : Number(g?.lum) || 0;
  const C = typeof g === "number" ? g * 0.6 : Number(g?.chroma) || 0;
  const r = rng(seed);
  const gauss = () => Math.sqrt(-2 * Math.log(r() || 1e-9)) * Math.cos(2 * Math.PI * r());
  // Three independent draws less their mean spread by sd*sqrt(2/3): scale back up to C.
  const cs = C / Math.sqrt(2 / 3);
  const data = Buffer.alloc(size * size * 4);
  for (let i = 0; i < size * size; i++) {
    const l = gauss() * L, e = [gauss(), gauss(), gauss()], m = (e[0] + e[1] + e[2]) / 3;
    for (let k = 0; k < 3; k++) data[i * 4 + k] = clamp(Math.round(P[k] + l + (e[k] - m) * cs));
    data[i * 4 + 3] = 255;
  }
  return encode({ width: size, height: size, data });
}

/** The masks and paper a Design Kit starts with (07 §1b). */
/**
 * What a rendered page looks like, in four numbers (13 §9 pre-screen).
 *
 * Sampled on a grid rather than every pixel: a page render is millions of
 * pixels and the answer does not change past a few thousand samples. The
 * ground is the page's most common colour, so a dark world's page is not
 * called crowded for being dark.
 */
export function inspect(file) {
  const img = decode(readFileSync(file));
  const { width: w, height: h, data } = img;
  const step = Math.max(1, Math.floor(Math.sqrt((w * h) / 40000)));
  const lum = [];
  const cols = Math.ceil(w / step);
  const hist = new Map();
  let accent = 0;
  let n = 0;
  for (let y = 0; y < h; y += step) {
    for (let x = 0; x < w; x += step) {
      const i = (y * w + x) * 4;
      const r = data[i] / 255, g = data[i + 1] / 255, b = data[i + 2] / 255;
      const max = Math.max(r, g, b), min = Math.min(r, g, b);
      if (max > 0.3 && max - min > 0.45 * max) accent += 1;
      lum.push(0.2126 * r + 0.7152 * g + 0.0722 * b);
      const key = ((data[i] >> 4) << 8) | ((data[i + 1] >> 4) << 4) | (data[i + 2] >> 4);
      hist.set(key, (hist.get(key) || 0) + 1);
      n += 1;
    }
  }
  let ground = 0, best = -1;
  for (const [k, v] of hist) if (v > best) { best = v; ground = k; }
  const gr = ((ground >> 8) & 15) * 17 / 255, gg = ((ground >> 4) & 15) * 17 / 255, gb = (ground & 15) * 17 / 255;
  let near = 0;
  for (let y = 0; y < h; y += step) {
    for (let x = 0; x < w; x += step) {
      const i = (y * w + x) * 4;
      const d = Math.abs(data[i] / 255 - gr) + Math.abs(data[i + 1] / 255 - gg) + Math.abs(data[i + 2] / 255 - gb);
      if (d < 0.18) near += 1;
    }
  }
  let edge = 0, pairs = 0;
  for (let k = 0; k < lum.length; k += 1) {
    if ((k + 1) % cols !== 0 && k + 1 < lum.length) { edge += Math.abs(lum[k] - lum[k + 1]); pairs += 1; }
    if (k + cols < lum.length) { edge += Math.abs(lum[k] - lum[k + cols]); pairs += 1; }
  }
  const mean = lum.reduce((a, b) => a + b, 0) / (lum.length || 1);
  const sd = Math.sqrt(lum.reduce((a, b) => a + (b - mean) ** 2, 0) / (lum.length || 1));
  const round = (v) => Math.round(v * 1000) / 1000;
  return { whitespace: round(near / n), accent: round(accent / n), busy: round(pairs ? edge / pairs : 0), contrast: round(sd), width: w, height: h };
}

export function drawKit(dir, { paper } = {}) {
  const files = [];
  const put = (rel, buf, kind) => {
    const file = join(dir, rel);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, buf);
    files.push({ kind, file: rel });
  };
  for (const kind of ["vignette", "bleed", "torn-edge"]) put(`masks/${kind}.png`, drawMask(kind), "mask");
  put("patterns/paper-grain.png", paperGrain(paper), "pattern");
  return files;
}
