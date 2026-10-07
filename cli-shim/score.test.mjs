// node --test cli-shim/score.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { assetCheck, measureRender, oklab } from "./score.mjs";

const PAPER = [247, 242, 232], INK = [30, 27, 24], HUE = [228, 87, 46];
const PALETTE = { paper: "#f7f2e8", ink: "#1e1b18", hue: "#e4572e" };

/** A page of paper with filled rectangles: [x, y, w, h, rgb] in pixels. */
function page(w, h, rects = []) {
  const data = Buffer.alloc(w * h * 4);
  for (let i = 0; i < w * h; i++) { data[i * 4] = PAPER[0]; data[i * 4 + 1] = PAPER[1]; data[i * 4 + 2] = PAPER[2]; data[i * 4 + 3] = 255; }
  for (const [x0, y0, rw, rh, rgb] of rects) {
    for (let y = y0; y < y0 + rh; y++) for (let x = x0; x < x0 + rw; x++) {
      const o = (y * w + x) * 4; data[o] = rgb[0]; data[o + 1] = rgb[1]; data[o + 2] = rgb[2];
    }
  }
  return { width: w, height: h, data };
}

test("colour distance is zero for the same colour and large for opposites", () => {
  const d = (a, b) => Math.hypot(...oklab(...a).map((v, i) => v - oklab(...b)[i]));
  assert.ok(d(PAPER, PAPER) < 1e-9);
  assert.ok(d(PAPER, INK) > 0.5);
});

test("a blank page is all paper, all whitespace, and balanced", () => {
  const m = measureRender(page(160, 224), { palette: PALETTE });
  assert.ok(m.shares.paper > 0.99);
  assert.ok(m.whitespace > 0.99);
  assert.ok(m.offPalette < 0.01);
  assert.ok(m.balance < 0.3); // no weight at all: centred on the optical centre
});

test("ink and hue are counted by what they are, outside the frames", () => {
  // Top quarter ink, a hue block, the rest paper.
  const img = page(160, 160, [[0, 0, 160, 40, INK], [0, 120, 160, 40, HUE]]);
  const m = measureRender(img, { palette: PALETTE });
  assert.ok(Math.abs(m.shares.ink - 0.25) < 0.02, `ink ${m.shares.ink}`);
  assert.ok(Math.abs(m.shares.hue - 0.25) < 0.02, `hue ${m.shares.hue}`);
  assert.ok(Math.abs(m.shares.paper - 0.5) < 0.02, `paper ${m.shares.paper}`);
  assert.ok(m.offPalette < 0.01);
});

test("a colour that is none of the declared ones is off palette, and a frame is not judged", () => {
  const GREEN = [20, 200, 60];
  const img = page(160, 160, [[0, 0, 160, 80, GREEN]]);
  assert.ok(measureRender(img, { palette: PALETTE }).offPalette > 0.45);
  // The same green inside an image frame is a picture, not a palette failure.
  const framed = measureRender(img, { palette: PALETTE, frames: [{ x: 0, y: 0, w: 1, h: 0.5 }] });
  assert.ok(framed.offPalette < 0.01);
});

test("weight in one corner leans the page and lowers the balance", () => {
  const left = page(160, 160, [[0, 0, 60, 160, INK]]);
  const m = measureRender(left, { palette: PALETTE });
  assert.ok(m.lean.x < -0.2, `lean ${m.lean.x}`);
  assert.ok(m.balance > 0.25);
  const centred = page(160, 160, [[50, 40, 60, 80, INK]]);
  assert.ok(measureRender(centred, { palette: PALETTE }).balance < m.balance);
});

test("a frame counts as filled, so a full-width picture leaves no whitespace there", () => {
  const img = page(160, 160);
  const m = measureRender(img, { palette: PALETTE, frames: [{ x: 0, y: 0, w: 1, h: 0.5 }] });
  assert.ok(Math.abs(m.whitespace - 0.5) < 0.05, `whitespace ${m.whitespace}`);
});

test("an asset: how much of its frame the subject fills, and the halo a bad cut leaves", () => {
  // 100x100 transparent frame, a solid 60x60 subject in the middle.
  const w = 100, data = Buffer.alloc(w * w * 4);
  const put = (x, y, a, rgb = INK) => { const o = (y * w + x) * 4; data[o] = rgb[0]; data[o + 1] = rgb[1]; data[o + 2] = rgb[2]; data[o + 3] = a; };
  for (let y = 20; y < 80; y++) for (let x = 20; x < 80; x++) put(x, y, 255);
  const clean = assetCheck({ width: w, height: w, data }, { palette: PALETTE, slotMm: [50, 50] });
  assert.ok(Math.abs(clean.fill - 0.36) < 0.01, `fill ${clean.fill}`);
  assert.equal(clean.haloShare, 0);
  assert.equal(clean.hasAlpha, true);
  assert.equal(clean.dpi, 51); // 100 px across 50 mm
  assert.ok(clean.deltaE < 0.01); // the subject is the world's ink

  // A stray half-transparent speck far from the subject is a halo.
  put(5, 5, 100);
  const dirty = assetCheck({ width: w, height: w, data }, { palette: PALETTE });
  assert.ok(dirty.haloShare > 0.9);
});

test("a solid block weighs its area; the same area of paper weighs nothing", () => {
  const img = page(210, 297, [[0, 0, 105, 100, INK]]);
  const m = measureRender(img, { palette: PALETTE, boxes: [
    { role: "image", x: 0, y: 0, w: 0.5, h: 100 / 297 },
    { role: "body", x: 0.5, y: 0, w: 0.5, h: 100 / 297 },
  ] });
  const [ink, blank] = m.weights;
  assert.ok(Math.abs(ink.weight - 105 * 100) / (105 * 100) < 0.05, `ink ${ink.weight}`);
  assert.equal(blank.weight, 0);
});
