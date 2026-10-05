// Self-check for LoRA splicing and the default workflow.
//
//   node --test cli-shim/workflows.test.mjs
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import assert from "node:assert/strict";

// A throwaway workspace, named after the instance so it never touches a real one.
const WS = mkdtempSync(join(tmpdir(), "quire-workflows-"));
const INSTANCE = `test${process.pid}`;
process.env.QUIRE_INSTANCE = INSTANCE;
process.env[`QUIRE_WORKSPACE_${INSTANCE.toUpperCase()}`] = WS;

const wf = await import("./workflows.mjs");

test("a second builtin never becomes the default by sorting first", () => {
  assert.equal(wf.selected().id, "z-image-turbo");
});

test("LoRA loaders are spliced between the checkpoint and its consumers", () => {
  const flux = wf.find("flux-schnell");
  const graph = wf.fill(flux.graph, { prompt: "p", negative: "n", width: 8, height: 8, steps: 4, seed: 1, prefix: "q", "model.ckpt": "c" });
  const out = wf.withLoras(graph, flux.lora, [{ file: "a.safetensors", strength: 0.7 }, { file: "b.safetensors", strength: 0.5 }]);
  assert.deepEqual(out.lora1.inputs.model, ["1", 0]);
  assert.deepEqual(out.lora2.inputs.model, ["lora1", 0]);
  assert.deepEqual(out["6"].inputs.model, ["lora2", 0]);
  assert.deepEqual(out["2"].inputs.clip, ["lora2", 1]);
  assert.deepEqual(out["3"].inputs.clip, ["lora2", 1]);
  assert.equal(graph.lora1, undefined, "the original graph is left alone");
});

test("a LoRA is picked only for its base and technique, and only when installed", () => {
  mkdirSync(join(WS, "workflows"), { recursive: true });
  writeFileSync(join(WS, "workflows", "loras.json"), JSON.stringify({
    loras: [{ id: "cut", base: "flux-schnell", file: "cut.safetensors", techniques: ["paper-cut"], trigger: "PAPERCUT", strength: 0.9 }],
  }));
  const installed = (f) => f === "cut.safetensors";
  assert.equal(wf.pickLoras({ base: "flux-schnell", technique: "Paper-cut collage", installed })[0]?.trigger, "PAPERCUT");
  assert.deepEqual(wf.pickLoras({ base: "z-image", technique: "paper-cut", installed }), []);
  assert.deepEqual(wf.pickLoras({ base: "flux-schnell", technique: "watercolour", installed }), []);
  assert.deepEqual(wf.pickLoras({ base: "flux-schnell", technique: "paper-cut", installed: () => false }), []);
});
