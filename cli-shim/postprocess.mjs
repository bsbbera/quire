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

/* ------------------------------------------------------------------- ops */
/** "#rrggbb" as [r,g,b], or null for anything else — `rgbOf` above assumes a hex. */
function groundRgb(value) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(value ?? ""));
  if (!m) return null;
  const hex = m[1];
  return [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16));
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
   * Take the white ground away. The prompt for every cutout treatment asks for
   * the subject "isolated on plain white", so a flood fill from the border over
   * near-white, low-chroma pixels finds the ground and leaves white inside the
   * subject (a white shirt, a snowflake) alone. Edges are softened one pixel
   * and de-fringed so no white halo is left round the figure.
   * ponytail: flood-fill key, not a segmentation model — a subject touching
   * every border keeps its ground. Upgrade: a BiRefNet/RMBG workflow in Comfy.
   */
  cutout(img, { tolerance = 26, ground = null } = {}) {
    const { width: w, height: h, data } = img;
    const n = w * h;
    /*
     * The ground is whatever the picture was asked to stand on.
     *
     * This keyed near-white only, so a cutout could be ordered on a white
     * ground and nothing else — and an element drawn on the section's own
     * paper colour, or on a flat panel that suits it, came back with the panel
     * baked in. The colour comes from the caller when the brief named one, and
     * off the corners when it did not, which is still white for a white one.
     */
    const key = groundRgb(ground) ?? corner(data, w, h);
    const white = (i) => {
      const o = i * 4;
      return Math.abs(data[o] - key[0]) <= tolerance
        && Math.abs(data[o + 1] - key[1]) <= tolerance
        && Math.abs(data[o + 2] - key[2]) <= tolerance;
    };
    const bg = new Uint8Array(n);
    const stack = [];
    const push = (i) => { if (!bg[i] && white(i)) { bg[i] = 1; stack.push(i); } };
    for (let x = 0; x < w; x++) { push(x); push((h - 1) * w + x); }
    for (let y = 0; y < h; y++) { push(y * w); push(y * w + w - 1); }
    while (stack.length) {
      const i = stack.pop(), x = i % w;
      if (x > 0) push(i - 1);
      if (x < w - 1) push(i + 1);
      if (i >= w) push(i - w);
      if (i < n - w) push(i + w);
    }
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
        // De-fringe against the ground that was actually keyed, not against white.
        if (t > 0 && t < 1) for (let k = 0; k < 3; k++) data[o + k] = clamp(Math.round((data[o + k] - key[k] * (1 - t)) / t));
        data[o + 3] = Math.round(data[o + 3] * t);
      }
    }
    const share = removed / n;
    return {
      removed: Math.round(share * 1000) / 1000,
      ground: `#${key.map((c) => c.toString(16).padStart(2, "0")).join("")}`,
      ...(share < 0.02 ? { warning: "no flat ground found round the subject" } : {}),
    };
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
