#!/usr/bin/env node
// The publication runner, driven with a stubbed model.
//
// The law is checked in test.mjs; this checks the machinery around it —
// storage, the approval gates, resume, and that a definition actually changes
// behaviour rather than only wording. No model is called, so it costs nothing
// and cannot flake.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const CORE = process.env.INKOS_CORE
  || join(process.cwd(), "inkos", "node_modules", "@actalk", "inkos-core");
const load = (rel) => import(pathToFileURL(join(CORE, rel)).href);

let failures = 0;
const check = async (name, fn) => {
  try { await fn(); console.log(`  ok   ${name}`); }
  catch (e) { failures++; console.log(`  FAIL ${name}: ${e.message}`); }
};

const runner = await load("dist/pipeline/publication-runner.js");
const registry = await load("dist/publications/registry.js");

const root = mkdtempSync(join(tmpdir(), "quire-pub-"));
try {
  const reg = await registry.loadPublicationRegistry(root);
  const magazine = reg.definitions.find((d) => d.definition.id === "magazine")?.definition;
  const cookbook = reg.definitions.find((d) => d.definition.id === "cookbook")?.definition;

  console.log("publication runner:");
  await check("both builtin definitions load", () => {
    assert.ok(magazine, "magazine definition missing");
    assert.ok(cookbook, "cookbook definition missing");
    assert.equal(reg.diagnostics.length, 0, JSON.stringify(reg.diagnostics));
  });

  // A stub that answers each stage with the shape that stage asks for. The
  // prompts are rendered for real, so a template that lost a placeholder still
  // shows up here as a prompt with an empty hole.
  const prompts = {};
  const ask = async (prompt, tag) => {
    prompts[tag] = prompt;
    if (tag === "research") {
      return { title: "A Test Issue", thesis: "Things are not what they seem.", origin: [{ fact: "x" }] };
    }
    if (tag === "plan") {
      return {
        sections: [{ n: 1, label: "one", question: "why?", colour: "green", from: 3, to: 6 }],
        pages: Array.from({ length: 16 }, (_, i) => ({
          n: i + 1,
          title: `Page ${i + 1}`,
          type: i === 2 ? "plate" : "feature",
          density: "M",
          section: i >= 2 ? 1 : 0,
          pillar: "origin",
          premise: "does a thing",
        })),
      };
    }
    return {
      title: "Written", deck: "a deck", body: "some words here",
      image_prompt: "a picture of something", image_orientation: "landscape",
      sources: [], uncertain: [],
    };
  };

  const ctx = { projectRoot: root, definition: magazine, ask };

  // 16 is the magazine minimum; asking for less is clamped, which is its own check below.
  const created = await runner.createIssue(ctx, { subject: "Test Subject", extent: 16 });
  await check("create writes an issue", () => {
    assert.equal(created.type, "magazine");
    assert.equal(created.extent, 16);
    assert.ok(existsSync(join(root, "Magazine", "issues", created.id, "publication.json")));
  });

  await check("art is refused before the copy is approved", async () => {
    await assert.rejects(
      () => runner.artPage({ ...ctx, shimUrl: "http://127.0.0.1:1" }, created.id, 1),
      /approved/,
    );
  });

  await runner.runResearch(ctx, created.id);
  await runner.runPlan(ctx, created.id);
  const planned = await runner.readIssue(ctx, created.id);
  await check("plan produces pages and runs the law", () => {
    assert.equal(planned.pages.length, 16);
    assert.ok(Array.isArray(planned.warnings));
  });
  await check("the rendered prompt has no empty placeholders", () => {
    assert.ok(!/\{\{\s*[a-zA-Z0-9_.]+\s*\}\}/.test(prompts.plan), "unfilled placeholder in plan prompt");
    assert.ok(prompts.plan.includes("16 pages"), "extent did not reach the prompt");
  });

  // Half the pages, then resume: the second pass must pick up exactly what is
  // left rather than rewriting from the beginning.
  await runner.writePage(ctx, created.id, 1);
  await runner.writePage(ctx, created.id, 2);
  const half = await runner.readIssue(ctx, created.id);
  await check("resume targets only the unwritten pages", () => {
    assert.deepEqual(runner.outstanding(half, "write", false),
      Array.from({ length: 14 }, (_, i) => i + 3));
    assert.deepEqual(runner.outstanding(half, "write", true).length, 16);
  });

  await check("a written page lands on disk as markdown", () => {
    const dir = join(root, "Magazine", "issues", created.id, "pages");
    assert.ok(existsSync(dir), "no pages directory");
    const first = readFileSync(join(dir, "01-written.md"), "utf-8");
    assert.ok(first.includes("some words here"), "page body missing from markdown");
  });

  await check("approval is refused while pages are unwritten", async () => {
    await assert.rejects(() => runner.approve(ctx, created.id), /not written/);
  });

  for (let n = 3; n <= 16; n++) await runner.writePage(ctx, created.id, n);
  await check("approval succeeds once every page is written", async () => {
    const approved = await runner.approve(ctx, created.id);
    assert.ok(approved.approved?.at);
  });

  await check("rewriting a page withdraws the approval", async () => {
    await runner.writePage(ctx, created.id, 1);
    const after = await runner.readIssue(ctx, created.id);
    assert.equal(after.approved, null);
  });

  // The point of the whole phase: same runner, different definition, different
  // law and different storage.
  const cookCtx = { projectRoot: root, definition: cookbook, ask };
  const cookIssue = await runner.createIssue(cookCtx, { subject: "Test Subject", extent: 25 });
  await check("a second definition runs the same code with its own rules", () => {
    assert.equal(cookIssue.type, "cookbook");
    // Cookbook has no even-extent rule, so 25 survives; a magazine would round.
    assert.equal(cookIssue.extent, 25);
    assert.ok(existsSync(join(root, "Cookbook", "issues", cookIssue.id, "publication.json")));
  });
  await check("an extent below the type's minimum is clamped up", async () => {
    const tiny = await runner.createIssue(ctx, { subject: "Tiny Extent", extent: 4 });
    assert.equal(tiny.extent, 16);
  });

  await check("the magazine's even-extent rule still applies to magazines", async () => {
    const odd = await runner.createIssue(ctx, { subject: "Odd Extent", extent: 25 });
    assert.equal(odd.extent, 26);
  });

  await check("a definition with needsImages false has no art stage", async () => {
    const noArt = { ...cookbook, needsImages: false };
    await assert.rejects(
      () => runner.artPage({ ...cookCtx, definition: noArt, shimUrl: "http://127.0.0.1:1" }, cookIssue.id, 1),
      /does not use generated images/,
    );
  });

  // Ported from test.mjs, which tested these against the magazine engine.
  // The engine is gone; the law it carried is not.
  const { parseJson } = await load("dist/publications/parse-json.js");
  await check("parseJson survives fenced output", () =>
    assert.deepEqual(parseJson('```json\n{"a":1}\n```'), { a: 1 }));
  await check("parseJson survives chatty output", () =>
    assert.deepEqual(parseJson('Sure! Here you go: {"a":1} hope that helps'), { a: 1 }));
  await check("parseJson survives a non-string reply", () =>
    assert.deepEqual(parseJson([{ text: '{"a":1}' }]), { a: 1 }));
  await check("parseJson rejects prose", () =>
    assert.throws(() => parseJson("no json at all")));

  await check("checkPlan passes a legal plan", () => {
    const legal = {
      extent: 4,
      sections: [{ n: 1, label: "one", from: 3, to: 4 }],
      pages: [
        { n: 1, type: "cover", density: "D", section: 0, pillar: "origin" },
        { n: 2, type: "statement", density: "M", section: 0, pillar: "evolution" },
        { n: 3, type: "plate", density: "D", section: 1, pillar: "today" },
        { n: 4, type: "feature", density: "M", section: 1, pillar: "strange" },
      ],
    };
    // Only the informational density line and the pillars it genuinely lacks.
    const warnings = runner.checkPlan({ ...magazine, extent: { ...magazine.extent } }, legal)
      .filter((w) => !w.startsWith("density"));
    assert.deepEqual(warnings, ["no page covers: underlying, real_work"]);
  });

  await check("checkDesign passes a legal system", () => {
    assert.deepEqual(runner.checkDesign({
      sections: [{ n: 1, register: "Swiss Modernism", idiom: "grid", paper: "#ffffff", ink: "#111111" }],
      fixed: { folio: "outer corner, 8pt" },
    }).filter((p) => !p.includes("not one of the 50")), []);
  });

  await check("checkDesign rejects a typeface shared by two sections", () => {
    const problems = runner.checkDesign({
      sections: [
        { n: 1, register: "Bauhaus", idiom: "a", paper: "#ffffff", ink: "#111111" },
        { n: 2, register: "Bauhaus", idiom: "b", paper: "#ffffff", ink: "#111111" },
      ],
      fixed: { folio: "x" },
    });
    assert.ok(problems.some((p) => p.includes("share the typeface")), problems.join("; "));
  });

  await check("checkDesign rejects unreadable ink on paper", () => {
    const problems = runner.checkDesign({
      sections: [{ n: 1, register: "Bauhaus", idiom: "a", paper: "#ffffff", ink: "#eeeeee" }],
      fixed: { folio: "x" },
    });
    assert.ok(problems.some((p) => p.includes("body copy needs 7:1")), problems.join("; "));
  });

  await check("a stopped queue leaves the rest outstanding", async () => {
    const q = await runner.createIssue(ctx, { subject: "Queue Test", extent: 16 });
    await runner.runResearch(ctx, q.id);
    await runner.runPlan(ctx, q.id);
    const state = await runner.startQueue(ctx, q.id, { kind: "write" });
    assert.equal(state.total, 16);
    runner.stopQueue();
    // Give the in-flight page time to settle before reading the state back.
    await new Promise((r) => setTimeout(r, 400));
    const after = await runner.readIssue(ctx, q.id);
    assert.ok(runner.outstanding(after, "write", false).length > 0, "a stopped queue wrote everything");
  });

  await check("listing reports progress per issue", async () => {
    const list = await runner.listIssues(ctx);
    const row = list.find((i) => i.id === created.id);
    assert.ok(row, "created issue missing from the list");
    assert.equal(row.pages, 16);
    assert.equal(row.written, 16);
  });
} finally {
  rmSync(root, { recursive: true, force: true });
}

console.log(failures ? `\n${failures} check(s) failed` : "\nall publication checks passed");
process.exit(failures ? 1 : 0);
