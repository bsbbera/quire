// Self-check for the image engine router.
//
// The routing decision is the part that has to be right: a picture sent to an
// engine that cannot draw it is a silently wrong picture, and an allowance
// error that is not recognised is a failed job. Both are checked here without
// touching Canva or ComfyUI.
//
//   node --test cli-shim/engines.test.mjs
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import assert from "node:assert/strict";

// A throwaway workspace. The instance name has no saved pointer, so the
// module's config lookup falls through to the env var — which is named after
// the instance, not the bare QUIRE_WORKSPACE that belongs to prod.
const WS = mkdtempSync(join(tmpdir(), "quire-engines-"));
const INSTANCE = `test${process.pid}`;
process.env.QUIRE_INSTANCE = INSTANCE;
process.env[`QUIRE_WORKSPACE_${INSTANCE.toUpperCase()}`] = WS;

const engines = await import("./engines.mjs");
const canva = await import("./canva.mjs");

const connect = (yes) => {
  mkdirSync(join(WS, ".quire"), { recursive: true });
  writeFileSync(join(WS, ".quire", "secrets.json"),
    JSON.stringify({ services: yes ? { canva: { apiKey: "test-token" } } : {} }));
};

test.after(() => rmSync(WS, { recursive: true, force: true }));

test("comfy is the default and needs no connection", () => {
  const picked = engines.choose({ surface: "illustration" });
  assert.equal(picked.engine, "comfy");
  assert.equal(picked.reason, null);
});

test("Canva is skipped when it is not connected", () => {
  connect(false);
  engines.savePrefs({ bySurface: { illustration: "canva" } });
  const picked = engines.choose({ surface: "illustration" });
  assert.equal(picked.engine, "comfy");
  assert.match(picked.reason, /not connected/);
});

test("a picture with a cast member never goes to Canva", () => {
  connect(true);
  engines.savePrefs({ bySurface: { illustration: "canva" }, plan: "pro" });
  const picked = engines.choose({ surface: "illustration", needs: ["refs", "seed"] });
  assert.equal(picked.engine, "comfy");
  assert.match(picked.reason, /reference image/);
});

test("a plain magazine picture does go to Canva", () => {
  connect(true);
  engines.savePrefs({ bySurface: { illustration: "canva" }, plan: "pro" });
  engines.noteUsage({ used: 3, exhausted: false, lastError: null });
  const picked = engines.choose({ surface: "illustration", needs: [] });
  assert.equal(picked.engine, "canva");
});

test("a spent allowance routes back to ComfyUI", () => {
  connect(true);
  engines.savePrefs({ bySurface: { illustration: "canva" }, plan: "pro" });
  engines.noteUsage({ used: engines.limitOf(), exhausted: false, lastError: null });
  const picked = engines.choose({ surface: "illustration", needs: [] });
  assert.equal(picked.engine, "comfy");
  assert.match(picked.reason, /allowance used up/);
});

test("the plan decides the limit", () => {
  engines.savePrefs({ plan: "free" });
  assert.equal(engines.limitOf(), 20);
  engines.savePrefs({ plan: "pro" });
  assert.equal(engines.limitOf(), 200);
});

test("Canva's way of saying 'out of allowance' is recognised", () => {
  assert.equal(canva.isQuotaError(429, "Too many requests"), true);
  assert.equal(canva.isQuotaError(402, "payment required"), true);
  assert.equal(canva.isQuotaError(400, "You have reached your usage limit for this month"), true);
  assert.equal(canva.isQuotaError(400, "design_type must be an object"), false);
  assert.equal(canva.isQuotaError(500, "internal error"), false);
});

test("usage resets when the month does", () => {
  engines.noteUsage({ used: 7 });
  assert.equal(engines.usage().used, 7);
  // A counter written under last month's key must read as a fresh month, or a
  // person who hit the limit in March can never render again in April.
  writeFileSync(join(WS, ".quire", "canva-usage.json"),
    JSON.stringify({ period: "1999-01", used: 500, exhausted: true }));
  assert.equal(engines.usage().used, 0);
  assert.equal(engines.usage().exhausted, false);
});
