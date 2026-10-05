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
    // A single backslash once reached Affinity as /s+/ and split prose on "s".
    assert.ok(script.includes("split(/\\s+/)"), "body split on whitespace");
    assert.ok(!script.includes("split(/s+/)"), "never on the letter s");
  }
  assert.match(whole, /"link":8/);
  assert.match(one, /"spread":true/);
});
