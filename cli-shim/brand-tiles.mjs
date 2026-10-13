// One grain for every colour: the paper and every ink are the same tile recipe, so a
// cream page and a red border carry identical speckle and mottle (the paper used to be a
// coarser, blocky noise and read as a different material).
// Seamless 512 px tile, laid 43 mm wide by build.js: per-pixel luminance + chroma grain
// (uncorrelated, as in a print) over a slow two-octave mottle that wraps at the edges.
// makeTiles(outDir, colours): one PNG per colour, named by its hex. Ported from Output/Brand/photo-film/tiles.mjs.
import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { encode } from './postprocess.mjs';

const S = 512, GRAIN = { lum: 6, chroma: 3.5 }, MOTTLE = 7;

function rng(a) { return () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
// periodic value noise: `cells` lattice points across the tile, smoothstep-interpolated
function periodic(cells, seed) {
  const r = rng(seed), v = Array.from({ length: cells * cells }, r), at = (i, j) => v[((j % cells + cells) % cells) * cells + ((i % cells + cells) % cells)];
  return (x, y) => {
    const fx = x / S * cells, fy = y / S * cells, i = Math.floor(fx), j = Math.floor(fy), u = fx - i, w = fy - j;
    const su = u * u * (3 - 2 * u), sw = w * w * (3 - 2 * w);
    return (at(i, j) * (1 - su) + at(i + 1, j) * su) * (1 - sw) + (at(i, j + 1) * (1 - su) + at(i + 1, j + 1) * su) * sw;
  };
}
let mottle = null;
function mottleOf() {
  if (mottle) return mottle;
  const broad = periodic(3, 11), mid = periodic(9, 12);
  mottle = new Float32Array(S * S);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) mottle[y * S + x] = ((broad(x, y) - .5) * .65 + (mid(x, y) - .5) * .35) * 2 * MOTTLE;
  return mottle;
}

export function makeTiles(OUT, COLOURS) {
  mkdirSync(OUT, { recursive: true });
  for (const hex of COLOURS) {
  if (existsSync(`${OUT}/${hex.slice(1).toLowerCase()}.png`)) continue;
  const P = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  const r = rng(5), g = () => Math.sqrt(-2 * Math.log(r() || 1e-9)) * Math.cos(2 * Math.PI * r());
  // dark inks show the same absolute speckle as more contrast: scale it by brightness a little
  const k = 0.6 + 0.4 * ((P[0] + P[1] + P[2]) / 765), cs = GRAIN.chroma / Math.sqrt(2 / 3);
  const data = Buffer.alloc(S * S * 4);
  for (let i = 0; i < S * S; i++) {
    const l = (g() * GRAIN.lum + mottleOf()[i]) * k, e = [g(), g(), g()], m = (e[0] + e[1] + e[2]) / 3;
    for (let c = 0; c < 3; c++) data[i * 4 + c] = Math.max(0, Math.min(255, Math.round(P[c] + l + (e[c] - m) * cs * k)));
    data[i * 4 + 3] = 255;
  }
  writeFileSync(`${OUT}/${hex.slice(1).toLowerCase()}.png`, encode({ width: S, height: S, data }));
  }
}
