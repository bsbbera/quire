// node --test cli-shim/postprocess.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { apply, decode, encode, OPS, drawKit } from "./postprocess.mjs";

/** A white 40×30 field with a dark 10×10 square in the middle. */
function subject() {
  const w = 40, h = 30, data = Buffer.alloc(w * h * 4, 255);
  for (let y = 10; y < 20; y++) for (let x = 15; x < 25; x++) {
    const o = (y * w + x) * 4; data[o] = 30; data[o + 1] = 40; data[o + 2] = 50;
  }
  return { width: w, height: h, data };
}
const alphaAt = (img, x, y) => img.data[(y * img.width + x) * 4 + 3];

test("PNG round trip keeps every pixel", () => {
  const img = subject();
  const back = decode(encode(img));
  assert.equal(back.width, 40);
  assert.equal(back.height, 30);
  assert.deepEqual(back.data, img.data);
});

test("cutout takes the white ground and keeps the subject", () => {
  const img = subject();
  const out = OPS.cutout(img);
  assert.ok(out.removed > 0.8);
  assert.equal(alphaAt(img, 0, 0), 0);
  assert.equal(alphaAt(img, 20, 15), 255);
});

test("vignette fades the corners and keeps the centre", () => {
  const img = subject();
  OPS.vignette(img);
  assert.equal(alphaAt(img, 0, 0), 0);
  assert.equal(alphaAt(img, 20, 15), 255);
});

test("apply keeps the original and a second treatment starts from it", () => {
  const dir = mkdtempSync(join(tmpdir(), "quire-post-"));
  const file = join(dir, "1-spread.png");
  writeFileSync(file, encode(subject()));
  const first = apply(file, [{ op: "cutout" }]);
  assert.equal(first.raw, ".raw/1-spread.png");
  assert.ok(existsSync(join(dir, ".raw", "1-spread.png")));
  apply(file, [{ op: "vignette" }], { fresh: false });
  // From the original: white ground inside the vignette's clear middle is
  // opaque, where the cutout had made it a hole.
  const img = decode(readFileSync(file));
  assert.equal(alphaAt(img, 20, 8), 255);
  apply(file, [], { fresh: false });
  assert.deepEqual(decode(readFileSync(file)).data, subject().data);
});

test("a kit starts with three masks and a paper tile", () => {
  const dir = mkdtempSync(join(tmpdir(), "quire-kit-"));
  const files = drawKit(dir, { paper: "#f1e9d8" });
  assert.equal(files.length, 4);
  for (const f of files) assert.ok(decode(readFileSync(join(dir, f.file))).width > 0);
});
