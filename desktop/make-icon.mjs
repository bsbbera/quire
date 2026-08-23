// Generates assets/icon.png with no image dependency — a raw RGBA PNG built by
// hand and deflated with node's zlib. `npm run icons` turns it into every
// platform size Tauri needs.
import { deflateSync } from "node:zlib";
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const S = 1024;
const HERE = dirname(fileURLToPath(import.meta.url));

const BG = [28, 26, 23];        // near-black, matches the UI's --ink
const INK = [201, 100, 66];     // --accent

const px = Buffer.alloc(S * S * 4);
const put = (x, y, [r, g, b], a = 255) => {
  const i = (y * S + x) * 4;
  // simple source-over so the shapes get antialiased edges
  const na = a / 255, ia = 1 - na;
  px[i] = r * na + px[i] * ia;
  px[i + 1] = g * na + px[i + 1] * ia;
  px[i + 2] = b * na + px[i + 2] * ia;
  px[i + 3] = Math.max(px[i + 3], a);
};

// rounded-square background
const R = S * 0.22;
for (let y = 0; y < S; y++) {
  for (let x = 0; x < S; x++) {
    const dx = Math.max(R - x, 0, x - (S - R - 1));
    const dy = Math.max(R - y, 0, y - (S - R - 1));
    const d = Math.hypot(dx, dy);
    const a = d <= R ? 255 : d <= R + 1 ? 255 * (R + 1 - d) : 0;
    if (a > 0) put(x, y, BG, a);
  }
}

// Quire mark: three nested folded sheets seen end-on from the spine — the
// gathering the product is named after. Drawn as stroked chevrons so the shape
// stays legible at 32px, where an outline or a fill both turn to mush.
function distToSeg(px_, py, ax, ay, bx, by) {
  const vx = bx - ax, vy = by - ay;
  const wx = px_ - ax, wy = py - ay;
  const t = Math.max(0, Math.min(1, (wx * vx + wy * vy) / (vx * vx + vy * vy)));
  return Math.hypot(px_ - (ax + t * vx), py - (ay + t * vy));
}

const cx = S / 2;
const STROKE = S * 0.037;
// Outer sheet widest and deepest, each inner one tucked inside. The tops are
// staggered as well as the widths: level tops plus a fat stroke close the gaps
// and the three sheets read as one solid arrow instead of a gathering.
const SHEETS = [
  { w: S * 0.270, top: S * 0.300, bot: S * 0.700 },
  { w: S * 0.180, top: S * 0.338, bot: S * 0.612 },
  { w: S * 0.092, top: S * 0.376, bot: S * 0.524 },
];

for (let y = 0; y < S; y++) {
  for (let x = 0; x < S; x++) {
    let a = 0;
    for (const sh of SHEETS) {
      const d = Math.min(
        distToSeg(x, y, cx - sh.w, sh.top, cx, sh.bot),
        distToSeg(x, y, cx, sh.bot, cx + sh.w, sh.top),
      );
      const half = STROKE / 2;
      const cov = d <= half ? 255 : d <= half + 1.2 ? 255 * ((half + 1.2 - d) / 1.2) : 0;
      if (cov > a) a = cov;
    }
    if (a > 0) put(x, y, INK, a);
  }
}

// PNG assembly
const raw = Buffer.alloc(S * (S * 4 + 1));
for (let y = 0; y < S; y++) {
  raw[y * (S * 4 + 1)] = 0; // filter: none
  px.copy(raw, y * (S * 4 + 1) + 1, y * S * 4, (y + 1) * S * 4);
}
const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
};
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(S, 0);
ihdr.writeUInt32BE(S, 4);
ihdr[8] = 8;   // bit depth
ihdr[9] = 6;   // RGBA
const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk("IHDR", ihdr),
  chunk("IDAT", deflateSync(raw, { level: 9 })),
  chunk("IEND", Buffer.alloc(0)),
]);

const out = join(HERE, "assets", "icon.png");
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, png);
console.log(`wrote ${out} (${S}x${S}, ${(png.length / 1024).toFixed(1)} KB)`);
