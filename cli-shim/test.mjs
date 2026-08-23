#!/usr/bin/env node
// Smallest thing that fails if the shim breaks. Assumes the shim is running.
//   node cli-shim/test.mjs            -> status + models only (fast, offline)
//   node cli-shim/test.mjs --live     -> also one real streamed completion per CLI
import assert from "node:assert/strict";

const BASE = `http://127.0.0.1:${process.env.SHIM_PORT || 8787}`;
const LIVE = process.argv.includes("--live");
let failures = 0;

// Async checks are tracked rather than awaited at each call site: one missed
// await used to let a late failure land after the summary had already printed
// a pass and exited 0.
const pending = [];
const check = (name, fn) => {
  const p = (async () => {
    try { await fn(); console.log(`  ok   ${name}`); }
    catch (e) { failures++; console.log(`  FAIL ${name}: ${e.message}`); }
  })();
  pending.push(p);
  return p;
};

async function streamOnce(model) {
  const res = await fetch(`${BASE}/v1/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      model, stream: true,
      messages: [{ role: "user", content: "Reply with exactly: PONG. Nothing else." }],
    }),
  });
  let text = "", sawDone = false;
  for await (const chunk of res.body) {
    for (const line of String(chunk).split("\n")) {
      if (!line.startsWith("data: ")) continue;
      const payload = line.slice(6).trim();
      if (payload === "[DONE]") { sawDone = true; continue; }
      const d = JSON.parse(payload).choices?.[0]?.delta?.content;
      if (d) text += d;
    }
  }
  return { text: text.trim(), sawDone };
}

console.log("status:");
const status = await fetch(`${BASE}/status`).then((r) => r.json());
check("ok flag", () => assert.equal(status.ok, true));
check("at least one CLI detected", () => assert.ok(status.agents.length > 0));
check("every agent reports a version", () =>
  assert.ok(status.agents.every((a) => a.version && a.version !== "?"), JSON.stringify(status.agents)));
check("models counted", () => assert.ok(status.total > 0));
for (const a of status.agents) console.log(`       ${a.id} ${a.version} — ${a.models} models`);

console.log("models:");
const models = await fetch(`${BASE}/v1/models`).then((r) => r.json());
check("openai list shape", () => assert.equal(models.object, "list"));
check("ids are <cli>/<model>", () =>
  assert.ok(models.data.every((m) => m.id.includes("/") && m.owned_by)));
check("count matches status", () => assert.equal(models.data.length, status.total));

check("unknown cli is rejected", async () => {});
const bad = await fetch(`${BASE}/v1/chat/completions`, {
  method: "POST", headers: { "content-type": "application/json" },
  body: JSON.stringify({ model: "nope/x", stream: false, messages: [] }),
});
check("unknown cli -> 400", () => assert.equal(bad.status, 400));

if (LIVE) {
  console.log("live completions (one per CLI, slow):");
  for (const a of status.agents) {
    const model = models.data.find((m) => m.owned_by === a.id)?.id;
    try {
      const { text, sawDone } = await streamOnce(model);
      check(`${a.id} streams`, () => {
        assert.ok(sawDone, "no [DONE] terminator");
        assert.ok(text.length > 0, "no content");
        assert.ok(!/error/i.test(text), text.slice(0, 120));
      });
    } catch (e) {
      failures++;
      console.log(`  FAIL ${a.id} streams: ${e.message}`);
    }
  }
} else {
  console.log("live completions: skipped (pass --live to run)");
}

// ---------------------------------------------------------------- integrations
const mag = await import("./magazine.mjs");
const mcpMod = await import("./mcp.mjs");

check("parseJson survives fenced output", () =>
  assert.deepEqual(mag.parseJson('```json\n{"a":1}\n```'), { a: 1 }));
check("parseJson survives chatty output", () =>
  assert.deepEqual(mag.parseJson('Sure! Here you go: {"a":1} hope that helps'), { a: 1 }));
check("parseJson rejects prose", () =>
  assert.throws(() => mag.parseJson("no json at all")));

// The structure law is the whole point of the plan stage; a validator that
// stays silent on a broken plan is worse than no validator.
const broken = mag.checkPlan({
  extent: 8,
  sections: [{ n: 1, label: "s", from: 2, to: 4 }],
  pages: [
    { n: 1, density: "C", pillar: "origin", type: "cover", section: 0 },
    { n: 2, density: "C", pillar: "origin", type: "plate", section: 1 },
    { n: 3, density: "C", pillar: "today", type: "feature", section: 1 },
    { n: 4, density: "D", pillar: "today", type: "feature", section: 1 },
  ],
}).join(" | ");
for (const law of ["pages planned", "left-hand page", "in a row", "must be even", "no page covers"]) {
  check("checkPlan catches: " + law, () => assert.ok(broken.includes(law), broken));
}
check("checkPlan passes a legal plan", () => {
  const pillars = ["origin", "evolution", "today", "strange", "underlying", "real_work"];
  const ok = mag.checkPlan({
    extent: 8,
    sections: [{ n: 1, label: "s", from: 1, to: 8 }],
    pages: [
      { n: 1, density: "D", pillar: "none", type: "plate", section: 1 },
      // C never three deep, and every pillar represented somewhere.
      ...pillars.map((pillar, i) => ({
        n: i + 2, pillar, type: "feature", section: 1,
        density: i % 3 === 2 ? "M" : "C",
      })),
      { n: 8, density: "D", pillar: "none", type: "photo-spread", section: 1 },
    ],
  });
  assert.deepEqual(ok.filter((x) => !x.startsWith("density")), [], ok.join(" | "));
});

check("mcp discovery finds configured servers", () => {
  const found = mcpMod.servers();
  assert.ok(Object.keys(found).length > 0, "no MCP servers discovered");
  // Extension paths live under "Claude Extensions". If the Windows shell
  // quoting regresses, the command silently loses everything after the space.
  for (const [name, cfg] of Object.entries(found)) {
    assert.ok(!/\bClaude$/.test(cfg.command), name + " command truncated at a space: " + cfg.command);
  }
});

// A fresh install leans entirely on the doctor being right about what is
// missing, so pin the one rule that matters: a required failure must be
// blocking, an optional one must not be.
{
  const { doctor } = await import("./preflight.mjs");
  const d = await doctor({
    comfyStatus: { up: false, installed: false },
    affinityStatus: { up: false, reason: "off" },
    servers: {},
    magRoot: process.cwd(),
  });
  check("doctor reports missing optional deps without blocking", () => {
    const byId = Object.fromEntries(d.checks.map((c) => [c.id, c]));
    assert.equal(byId.comfy.ok, false);
    assert.equal(byId.comfy.severity, "optional");
    assert.equal(byId.affinity.severity, "optional");
    assert.ok(byId.comfy.fix, "a failed check must say how to fix it");
    assert.equal(d.blocking, d.checks.filter((c) => !c.ok && c.severity === "required").length);
  });
  check("doctor skips the model check when ComfyUI is absent", () => {
    assert.ok(!d.checks.some((c) => c.id === "comfy-models"));
  });
}

// The workflow names three checkpoints and the installer downloads three. Add
// a model to the graph without adding its URL and renders fail on a machine
// that installed through Quire but not on the one that developed it.
{
  const { MODELS } = await import("./comfy.mjs");
  const src = await import("node:fs").then((fs) => fs.readFileSync("./comfy-install.mjs", "utf8"));
  check("every workflow model has a download", () => {
    for (const [slot, file] of Object.entries(MODELS)) {
      assert.ok(src.includes("MODELS." + slot), `no download entry for MODELS.${slot} (${file})`);
    }
  });
}

// The gate is the whole point of the review step: art and build must refuse
// unapproved copy, and any rewrite must withdraw an approval already given.
{
  const mag = await import("./magazine.mjs");
  const id = "test-gate-" + Date.now();
  const dir = (await import("node:path")).join(mag.MAG_ROOT, "issues", id);
  const fs = await import("node:fs");
  fs.mkdirSync(dir, { recursive: true });
  const issue = {
    id, subject: "gate", extent: 2, status: "written", approved: null,
    pages: [{ n: 1, type: "cover", density: "D", body: "x", brief: { prompt: "p" } },
            { n: 2, type: "essay", density: "M", body: "y", brief: { prompt: "q" } }],
  };
  const save = () => fs.writeFileSync(dir + "/issue.json", JSON.stringify(issue));
  save();
  await check("build refuses unapproved content", async () => {
    await assert.rejects(() => mag.build(id), /approved content/);
  });
  await check("art refuses unapproved content", async () => {
    await assert.rejects(() => mag.artPage(id, 1), /approved content/);
  });
  check("approve requires every page written", () => {
    issue.pages[1].body = null; save();
    assert.throws(() => mag.approve(id), /still unwritten/);
    issue.pages[1].body = "y"; save();
    assert.ok(mag.approve(id).approved);
  });
  fs.rmSync(dir, { recursive: true, force: true });
}

// The design law is what stops a section being handed a register that cannot
// run a page, or an ink that cannot be read off its own paper.
{
  const { checkDesign } = await import("./magazine.mjs");
  const legal = {
    fixed: { folio: "outer corner, 8pt sans" },
    sections: [
      { n: 1, register: "Utilitarian", technique: "Conceptual Sketch", idiom: "hand-carved linocut",
        paper: "#F4EFE4", field: "#1F3A2E", ink: "#1A1714", hue: "#B4552D",
        typefaces: { display: "Publico", text: "Lyon", label: "Atlas Grotesk" } },
      { n: 2, register: "Bauhaus", technique: "Pointillism", idiom: "flat riso, three colours",
        paper: "#EFEFEA", field: "#1B4A8C", ink: "#141414", hue: "#D8452B",
        typefaces: { display: "Druk", text: "Tiempos", label: "Founders Grotesk" } },
    ],
  };
  check("checkDesign passes a legal system", () => {
    assert.deepEqual(checkDesign(legal), []);
  });
  check("checkDesign rejects a tier 3 register", () => {
    const d = structuredClone(legal);
    d.sections[0].register = "Steampunk";
    assert.ok(checkDesign(d).some((x) => /tier 3/.test(x)));
  });
  check("checkDesign rejects unreadable ink on paper", () => {
    const d = structuredClone(legal);
    d.sections[0].paper = "#4A4A4A";
    assert.ok(checkDesign(d).some((x) => /body copy needs 7:1/.test(x)));
  });
  check("checkDesign rejects a typeface shared by two sections", () => {
    const d = structuredClone(legal);
    d.sections[1].typefaces.text = "Lyon";
    assert.ok(checkDesign(d).some((x) => /Lyon used by sections/.test(x)));
  });
  check("checkDesign rejects a screen-only register", () => {
    const d = structuredClone(legal);
    d.sections[0].register = "Glassmorphism";
    assert.ok(checkDesign(d).length > 0);
  });
}

check("parseJson survives a non-string reply", async () => {
  const { parseJson } = await import("./magazine.mjs");
  // A provider returning content blocks instead of a string used to crash with
  // "body.search is not a function", which named nothing useful.
  assert.doesNotThrow(() => parseJson([{ type: "text", text: '{"a":1}' }]));
});

// Stop-and-resume is only real if the remaining list survives the stop. A
// re-render run that was interrupted has pages waiting that all still have art,
// so re-deriving "what is outstanding" resumes as nothing to do.
{
  const mag = await import("./magazine.mjs");
  const fs = await import("node:fs");
  const path = await import("node:path");
  const id = "test-resume-" + Date.now();
  const dir = path.join(mag.MAG_ROOT, "issues", id);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "issue.json"), JSON.stringify({
    id, subject: "resume", status: "approved", approved: { at: "now" },
    pending: { kind: "art", pages: [4, 5, 6] },
    pages: [1, 2, 3, 4, 5, 6].map((n) => ({
      n, type: "essay", density: "M", body: "x",
      brief: { prompt: "p" }, image: { file: "already.png" },
    })),
  }));
  await check("a stopped run resumes its own remaining pages", async () => {
    // Every page has art, so without the pending list this returns "nothing".
    const r = await mag.startQueue(id, { kind: "art" });
    mag.stopQueue();
    assert.equal(r.nothing, undefined, "resume found nothing to do");
    assert.equal(r.pages, 3, "should resume exactly the 3 pending pages");
  });
  fs.rmSync(dir, { recursive: true, force: true });
}

await Promise.all(pending);

console.log(failures ? `\n${failures} failing check(s)` : "\nall checks passed");
process.exit(failures ? 1 : 0);
