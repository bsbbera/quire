// node --test cli-shim/affinity-map.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { layoutScript, mapData, onePageScript } from "./affinity.mjs";

/** A small issue on the web: a map spread, two tied pages, a closing page. */
const issue = {
  id: "indigo", title: "Indigo", subject: "indigo",
  web: { centre: "Indigo", rings: ["origin", "people"], accent: { hex: "#2b3a67" } },
  sections: [{ n: 1, from: 6, to: 9 }],
  pages: [
    { n: 4, type: "map", ring: "", title: "The web", deck: "Follow a thread", body: "One colour, everywhere." },
    { n: 5, type: "map", ring: "", title: "", body: "" },
    { n: 6, type: "feature", ring: "origin", title: "Before blue had a name", body: "Six thousand years ago in Peru.",
      links: [{ to: 8, why: "the same vats", cue: "vat" }] },
    { n: 8, type: "feature", ring: "people", title: "Keeping the vat alive", body: "A vat can outlive its dyer." },
    { n: 9, type: "in-your-hands", ring: "people", title: "Your jeans", body: "Look down." },
  ],
};

test("the map holds each ring, its pages, and the rings a bridge ties", () => {
  const map = mapData(issue);
  assert.equal(map.centre, "Indigo");
  assert.deepEqual(map.rings, [
    { name: "origin", pages: [6] },
    { name: "people", pages: [8, 9] },
  ]);
  assert.deepEqual(map.pairs, [[0, 1]]);
  assert.equal(map.accent, "#2b3a67");
});

test("both layout scripts parse, carry the map, and split body text on whitespace", () => {
  const whole = layoutScript(issue, {});
  const one = onePageScript(issue, issue.pages[0], null, {});
  for (const script of [whole, one]) {
    assert.doesNotThrow(() => new Function(script));
    assert.match(script, /T\.webMap\(/);
    // The body is split in Node (bodyItems), not in the template, so no regex
    // can lose a backslash on the way to Affinity; and the columns are balanced.
    assert.ok(!script.includes("split(/s+/)"), "never on the letter s");
    assert.match(script, /pourBalanced\(/);
    assert.ok(!script.includes("String(p.body)") && !script.includes("String(P.body)"));
  }
  assert.match(whole, /"link":8/);
  assert.match(one, /"spread":true/);
});

test("body markdown becomes headed paragraphs, never literal hashes", async () => {
  const { bodyItems } = await import("./affinity.mjs");
  const items = bodyItems("First para here.\n\n### A heading\n\nSecond **bold** para.");
  assert.deepEqual(items.map((i) => i.t), ["First", "para", "here.", "A", "heading", "Second", "bold", "para."]);
  assert.deepEqual(items.map((i) => i.k).join(""), "ppphhppp");
  assert.deepEqual([...new Set(items.map((i) => i.g))], [0, 1, 2]);
  assert.ok(!items.some((i) => i.t.includes("#")));
});

test("emphasis, links, lists and quotes lose their marks; what is left is caught as a leak", async () => {
  const { bodyItems, leaksOf } = await import("./affinity.mjs");
  const words = bodyItems("A *soft* word and _another_, a [link](http://x.y) and `code`.\n\n- a list item\n> a quote").map((i) => i.t);
  assert.deepEqual(words, ["A", "soft", "word", "and", "another,", "a", "link", "and", "code.", "a", "list", "item", "a", "quote"]);
  assert.deepEqual(leaksOf(words), []);
  assert.deepEqual(leaksOf(["Title", "### stray **bold"]), ["###", "**"]);
});

test("the one-page script tags each frame with its role and honours a variant", () => {
  const spec = { pages: { 8: { layout: "editorial", imageSlot: "none", variant: "big-deck" } } };
  const page = { n: 8, type: "feature", title: "Keeping the vat alive", deck: "A vat can outlive its dyer.", body: "Words." };
  const one = onePageScript({ ...issue, design: { spec } }, page, null, {});
  assert.doesNotThrow(() => new Function(one));
  assert.match(one, /"variant":"big-deck"/);
  assert.match(one, /R_\("title"\)/);
  assert.match(one, /R_\("pull"\)/);
});
