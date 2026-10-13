#!/usr/bin/env node
// A branded issue through the real design stage, with a stubbed model that answers
// off-brand on purpose: its own palette, faces, a guest register, a bird on a running
// page, a gold alpana. The brand (core brand.ts) must hold all of it. No model is called.
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const STAGED = join(process.cwd(), "engine", "node_modules", "@actalk", "quire-core");
const CORE = process.env.QUIRE_CORE
  || (existsSync(STAGED) ? STAGED : fileURLToPath(new URL("../vendor/studio/packages/core", import.meta.url)));
const load = (rel) => import(pathToFileURL(join(CORE, rel)).href);
const runner = await load("dist/pipeline/publication-runner.js");
const registry = await load("dist/publications/registry.js");
const brands = await load("dist/pipeline/brand.js");

let failures = 0;
const check = async (name, fn) => {
  try { await fn(); console.log(`  ok   ${name}`); } catch (e) { failures++; console.log(`  FAIL ${name}: ${e.message}`); }
};

const root = mkdtempSync(join(tmpdir(), "quire-brand-"));
try {
  const reg = await registry.loadPublicationRegistry(root);
  const magazine = reg.definitions.find((d) => d.definition.id === "magazine").definition;
  const prompts = {};
  const ask = async (prompt, tag) => {
    prompts[tag.replace(/-[a-z0-9]{6,}$/, "")] = prompt;
    if (tag.startsWith("design-art")) {
      return { idea: "a bird and gold", shapes: [
        { s: "bird", x: 150, y: 200, w: 40, h: 35, p: { body: "kajol" } },
        { s: "alpana", x: 20, y: 200, w: 40, h: 40, p: { solid: "gold" } },
        { s: "kantha", x: 0, y: 0, w: 1, h: 1, pts: [[30, 150], [90, 170]], p: { ink: "sindur" } },
      ] };
    }
    if (tag.startsWith("design")) {
      return {
        direction: { composition: "airy", type: "big", colour: "neon", art: "flat", rhythm: "loud then quiet" },
        palette: { paper: "#ffffff", ink: "#000000", accent: "#39ff14" },
        fixed: { folio: "foot, outer corner", trim: "A4", grid: "columns, calm", divider: "a rule" },
        type: { display: "Bodoni MT", text: "Georgia", scale: [60, 30, 10] },
        grid: { system: "golden", columns: 12, gutterMm: 5, marginMm: 15, baselineMm: 4.5 },
        imageDirection: "neon vaporwave",
        sections: [{ n: 1, register: "Vaporwave", technique: "Neon", idiom: "kantha paths over padma panels", pair: ["padma", "kolapata"], lead: "kantha", bn: "নদীর পথ",
          language: { paper: "#ffffff", ink: "#000000", accent: "#ff00ff", second: "#00ffff", third: "#ffff00", field: "#ff00ff",
            panel: { fill: "accent", stroke: "ink", weight: 2, radius: 9, cut: 4, shadow: { dx: 2, dy: 2, colour: "ink" }, rotate: 5 },
            title: "accent", kicker: { ground: "accent", bar: null, track: .2 }, motif: "river stitches" } }],
        pages: {},
      };
    }
    return {};
  };
  const ctx = { projectRoot: root, definition: magazine, ask, signal: undefined };
  const created = await runner.createIssue(ctx, { subject: "Rivers", extent: 16 });
  // Planned and written by hand: one section, sixteen short pages.
  const file = join(root, "Magazine", "issues", created.id, "publication.json");
  const issue = JSON.parse(readFileSync(file, "utf-8"));
  issue.title = "Where rivers go";
  issue.sections = [{ n: 1, label: "Follow the water", question: "where does a river go?", from: 3, to: 14 }];
  issue.pages = Array.from({ length: 16 }, (_, i) => ({ n: i + 1, title: `Page ${i + 1}`, type: i === 0 ? "cover" : "feature", density: "M",
    section: i >= 2 && i <= 13 ? 1 : 0, pillar: "origin", premise: "water moves", body: "A river begins as rain. ".repeat(20), deck: "Where does it go?",
    furniture: [], briefs: [] }));
  issue.approved = true;
  writeFileSync(file, JSON.stringify(issue, null, 2));
  await runner.setIssueBrand(ctx, created.id, "ochin");

  await check("an unknown brand is refused", async () => {
    await assert.rejects(() => runner.setIssueBrand(ctx, created.id, "nope"), /no brand named/);
  });

  let designed = null, error = null;
  try { designed = await runner.runDesign(ctx, created.id); } catch (e) { error = e; }
  await check("the design stage runs under the brand", () => { if (error) throw error; });
  const ochin = brands.loadBrand("ochin");
  if (designed) {
    const spec = designed.design.spec, w = designed.design.sections[0];
    await check("palette, faces and ladder are the brand's, whatever the model said", () => {
      assert.deepEqual([spec.palette.paper, spec.palette.ink, spec.palette.accent], ["#F6EEDC", "#1E1A1D", "#D23A1E"]);
      assert.equal(spec.type.display, "Tiro Bangla"); assert.equal(spec.type.text, "Anek Bangla");
      assert.deepEqual(spec.type.scale, [66, 42, 28, 16, 11]);
      assert.match(spec.imageDirection, /gouache/);
    });
    await check("the section is held to its pair, its lead and its Bengali name", () => {
      assert.deepEqual(w.pair, ["padma", "kolapata"]); assert.equal(w.lead, "kantha"); assert.equal(w.bn, "নদীর পথ");
      assert.equal(w.brand, "ochin");
      assert.deepEqual(brands.offBrandColours(ochin, { w, spec: spec.palette }), []);
      assert.equal(w.language.panel.radius, 0); assert.equal(w.language.panel.shadow, null);
      assert.match(w.imagePrompt, /gouache/);
    });
    await check("the design prompt carried the brand, its references and no recent-designs ban", () => {
      const p = prompts["design"] ?? Object.entries(prompts).find(([k]) => k.startsWith("design"))?.[1] ?? "";
      assert.match(p, /THIS WORK IS OCHIN/);
      assert.match(p, /pair/);
      assert.doesNotMatch(p, /must not repeat their type pair/);
    });
    const art = Object.values(designed.design.spec.pages ?? {}).flatMap((p) => p.shapes ?? []);
    await check("page art keeps brand shapes to their rations and colours", () => {
      if (!art.length) return console.log("       (no page took art in the stub run)");
      assert.equal(art.filter((s) => s.s === "bird").length, 0, "a bird on a running page");
      for (const s of art.filter((s) => s.s === "alpana")) assert.notEqual(s.p?.solid, "gold");
    });
    await check("checkDesign accepts a brand world", () => {
      const bad = runner.checkDesign(designed.design).filter((b) => /not one of the 50|tier/.test(b));
      assert.deepEqual(bad, []);
    });
  }
} finally {
  rmSync(root, { recursive: true, force: true });
}
console.log(failures ? `\n${failures} check(s) failed` : "\nall brand checks passed");
process.exit(failures ? 1 : 0);
