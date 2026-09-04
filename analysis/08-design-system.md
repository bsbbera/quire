# 08 — A Buildable Design System: Worlds = Movement × Technique × Props

## Can a design system be built? Yes — as data, not as vibes

The trap is treating "design system" as an infinite creative space. It isn't. It's a
**finite set of named, versioned spec files** ("design worlds") that the planner picks
from and the page spec (06) references. `TK_CFG.worlds` already hints at this — this
file makes it real.

## The three axes (exactly as the user framed them)

A **world** is one coordinate in a 3-axis space:

| Axis | What it controls | Examples |
|---|---|---|
| **System** (design movement) | grid discipline, type scale, color logic, spacing, composition rules | Bauhaus, Swiss/International, Utilitarian/brutal, Art Deco, Memphis, Mid-century editorial, Constructivism, Zen/Ma |
| **Technique** (image & mark making) | how artwork is produced/treated | watercolor, pixel art, surrealist collage, risograph, hatching/engraving, gouache, photo-duotone, paper-cut |
| **Props** (world flavor) | subject dressing, ornaments, icon vocabulary, texture set | Mystical Western, Nautical, Nordic field-notes, Retro-futurist lab, Botanical archive, Cosmic folklore |

Not all combinations work — and that's fine. Ship a **compatibility matrix**: each
system lists techniques it tolerates (Swiss + risograph ✓, Swiss + surrealist collage ⚠
only as the 10% accent, Bauhaus + watercolor ✗). Curated combos get names and become
the shipped worlds (12–20 at launch); users can compose new ones, validator warns on ✗.

## World spec format

```
workspace/design/worlds/<id>/
  world.json          — the machine spec (below)
  references/*.jpg    — 4–8 reference images (moodboard; also few-shot for image gen)
  rules.jsonl         — taste-loop accretions (06)
  preview.png         — auto-built sample spread
```

```json
{
  "id": "nordic-fieldnotes",
  "system": { "base": "swiss",
    "grid": { "cols": 6, "baseline": 13.5, "margins": "generous" },
    "typeScale": { "ratio": 1.333, "display": "Haettenschweiler", "body": "Lora", "caption": "Franklin Gothic Book" },
    "color": { "ground": "bone", "ink": "#1a1a1a", "accents": ["olive","clay"], "rule": "60-30-10" },
    "composition": ["one-dominant", "asymmetric", "whitespace>=18%"] },
  "technique": { "primary": "watercolor", "treatment": "cutout-forward",
    "imagePrompt": "loose watercolor, visible paper grain, muted nordic palette, isolated on white",
    "postProcess": ["rembg", "grain(0.15)"] },
  "props": { "theme": "field-notes", "icons": "thin-line-specimen",
    "ornaments": ["wave-rule-03", "brackets-01"],       // component library ids (07)
    "textures": ["paper-cold-press"], "motifLexicon": ["compass", "leaf", "twine"] },
  "breakBudget": { "perSpread": 1, "perIssueRatio": 0.2 },   // ties into 06
  "math": { "dominantRatio": 2.0, "maxSizesPerPage": 4 }
}
```

Note what this unifies: the **image prompt fragment** (feeds Comfy recipes, 09), the
**TK palette/faces** (feeds Affinity, 07), the **validator constants** (feeds 06), and
the **reference images** (feed both the moodboard UI and image-gen conditioning). One
world file drives text-adjacent visuals, generated art, and layout — that's the whole
point of a design system.

## Reference images & math — "no nonsense"

- References are curated by the user (drag-drop into the world), not generated. They
  anchor image-gen (IPAdapter/style conditioning in the Comfy workflow) and human review.
- Math lives in the spec as *checkable numbers*: grid, ratio, whitespace %, dominant
  ratio, contrast minimums (quire-core's `checkDesign` already checks contrast — extend).
- Every rule is either **a number the validator checks** or **a sentence the LLM reads**.
  Anything that is neither gets deleted from the spec. That's the no-nonsense filter.

## Breaking rules like an artist (system level)

06 covers per-page breaks. At the *system* level:

- Each world declares its own sacred rules (`composition[]`) and its **break budget**.
- A "shock spread" archetype in the flatplan is the sanctioned place where the world's
  technique axis flips (e.g. the watercolor issue gets one photographic spread). One
  per issue, never on the cover, always content-motivated.
- Worlds can define a **counter-world** (`shockWorld: "duotone-photo"`) so even the
  rebellion is art-directed.

## In-app UI before main design? Yes — three screens, high value

1. **World Gallery** — card per world: preview spread, reference strip, system/technique
   /prop chips. Pick one when creating an issue/book. (This is the "choose your look"
   moment — make it gorgeous; it sells the product in screenshots.)
2. **World Composer** — three-column picker (System | Technique | Props) with the
   compatibility matrix live-validating; right side renders a *sample page* using the
   template + a stock cutout, via the renderPage pipeline (07). Save-as-new-world.
3. **World Detail / Taste tab** — the rules.jsonl approval queue (06), reference
   management, "rebuild preview".

These are plain CRUD + one render call — cheap to build once 07's render works, and
they make the whole design engine *visible*, which matters for sellability.

## Works for novels and storybooks too

Worlds are not magazine-only. A novel uses the same spec with a reduced surface:
type scale, page geometry, chapter-opener ornament, cover art technique/props. A
children's storybook uses a picture-dominant archetype set. Add a `surface` field
(`magazine | book | storybook | cover-only`) so the validator knows which rules apply.

## Build order

1. World schema + loader + 3 hand-written worlds. — M
2. Wire world → TK config + Comfy prompt fragment (replace ad-hoc TK_CFG). — M
3. World Gallery UI. — S
4. Composer + compatibility matrix. — M
5. Taste tab (with 06's loop). — M
