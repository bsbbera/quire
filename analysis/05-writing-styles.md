# 05 — Writing Style: Analyzer Fidelity, Restyle, Multi-Voice Blends

> Updated 2026-09-07. Verified: `agents/style-analyzer.ts:30-116` (`analyzeStyle` —
> pure heuristics: sentence/paragraph stats, TTR, top-5 openers, regex rhetorical
> features), `pipeline/style-guide.ts:50-183` (`writeStyleGuide` — one LLM pass →
> `style_guide.md` with quoted evidence; deterministic fallback < 500 chars),
> `pipeline/style-library.ts` (`styles/<id>/{style.json, style_guide.md,
> style_profile.json}`, `applyStyleTo()` copies into the work), `pipeline/restyle.ts:104-145`
> (`restyleProse` — **whole file in one call**, length ratio guard 0.55–1.9,
> `formatProse` paragraph repair), `server.ts:7275-7312` (language resolution: explicit →
> book → project), `server.ts:7501-7665` (restyle route, targets chapters/spreads/
> scenes/panels, `.pre-audit.md` backup, records `voice` + `restyles`).

## Status

| Piece | State |
|---|---|
| Named voice library, save from sample, apply from either screen | done |
| Per-file voice shown on audit screen; restyle recorded as `rewritten` | done |
| Sample read in its own language (zh/en) | done |
| Quantitative fingerprint | partial — 7 coarse features |
| Few-shot exemplars in the restyle/writer prompt | **no** — the model only sees a prose description |
| Restyle verification (did the output actually land in the voice?) | **no** |
| Chunked restyle | no — whole file, one call |
| Multiple styles per work / blending | no — one `voice` per work |
| Style adherence as an audit finding | no |
| Composable layer taxonomy (voice/structure/genre/audience) from the old plan | not built; **dropped** as the primary model — see §4 |

## Status (2026-09-11)

**Done:** §2a fingerprint v2 + `distance()` + `gaps()`, §2b Do/Don't +
Signature moves + Not-this in the guide prompt, §2c exemplars saved and shown,
§3 chunked restyle with preservation check and one measured retry, distance
recorded and shown, §4 blends with facet ownership, §5 the `style-drift`
dimension.

**Not done:** the live "Sample" button in the mixer, merging Do/Don't lines per
facet into one compiled guide, style packs (18 §7).

## 1. Why results feel inauthentic today, and the three fixes

A restyle is one LLM call with a *description* of a voice. Descriptions are lossy in
both directions: the analyzer compresses 5 pages into eight adjectives, and the
rewriter re-expands adjectives into its own house style. Authenticity comes from
**showing, measuring, and iterating**:

1. **Show** — few-shot exemplars from the sample are the single biggest fidelity
   lever, and the library stores none.
2. **Measure** — a fingerprint that is rich enough to tell two authors apart, computed
   on the output as well as the sample.
3. **Iterate** — a second pass that targets the measured gap, not a vague "more like".

## 2. The analyzer: two layers, one fingerprint

### 2a. Quantitative fingerprint (deterministic, no tokens) — extend `analyzeStyle`

Keep the existing seven; add the features stylometry actually uses to attribute
authorship, so the profile can *discriminate*:

| Group | Features |
|---|---|
| Sentence | length histogram (buckets 1–5,6–10,…,40+), stddev (exists), % fragments, % starting with subject vs adverbial vs conjunction, clause depth proxy (commas+subordinators per sentence) |
| Paragraph | length distribution (exists), % one-sentence paragraphs, dialogue-paragraph ratio |
| Lexical | TTR (exists), hapax ratio, mean word length, **function-word profile** (relative frequency of the top-100 function words — the Burrows' Delta basis), adverb (-ly) density, adjective density, contraction rate, Latinate vs Germanic ratio (EN) |
| Punctuation | per 1000 words: em-dash, semicolon, colon, ellipsis, exclamation, question, parenthesis; quotation style |
| Discourse | POV (1st/3rd, detected), tense, dialogue % of text, said-bookism rate vs bare "said", sensory-word density (sight/sound/smell/touch/taste lists), abstract-noun density |
| Rhetoric | existing regex set + anaphora, tricolon, chiasmus proxies |
| Shape | opening-line length, closing-line length, average scene length (by heading/`***`) |

Chinese gets the same groups with character-level units and its own function-word
list (already partly the case for TTR). Store as `style_profile.json` v2 (versioned;
v1 profiles are re-analysed lazily).

**Distance** = z-scored Burrows' Delta over the function-word profile + weighted
Euclidean over the rest. This one number is what "authentic" means operationally.

### 2b. Qualitative guide (LLM) — keep, tighten

`writeStyleGuide` already asks for quoted evidence. Add: (a) a **"Do / Don't" block**
of 8–12 imperative rules derived from the quotes ("open scenes on an object, not
weather"); (b) a **"Signature moves"** list of 3–5 named devices with one quote each;
(c) explicit **"Not this"** — the two or three generic-AI habits most opposed to this
voice. Rules and moves are what the rewriter can act on; adjectives are not.

### 2c. Exemplars

`styles/<id>/samples/*.md`: on save, auto-select 3–5 passages of 120–250 words that
are **closest to the profile centroid** (most typical) plus one at the dialogue
extreme and one at the description extreme. These are what few-shot uses.

## 3. Restyle: chunked, few-shot, verified

```
for each section (heading / ~1200 words, with 2 paragraphs of overlap context):
  prompt = [EN_SYSTEM (exists)] + [Do/Don't + Signature moves] + [2–3 exemplars,
           chosen by similarity of *content type* to the chunk: dialogue-heavy →
           dialogue exemplar] + [Setting Card lexicon.prefer if any (22)] + chunk
  out    = model(prompt)
  guard  = length ratio (exists) + event/dialogue-line preservation check
           (every quoted line in input appears, possibly reworded, in output —
           count match ≥ 90%) + fingerprint(out) vs target
  if distance > τ: second pass with a *targeted* instruction generated from the
    largest feature gaps ("your sentences average 19 words, target 11; use 0
    semicolons; 30% of paragraphs should be one sentence") — one retry only
write; record in audit-state: voice, distance before/after, passes
```

The **distance before/after** is shown in the UI next to the voice pill ("in Rhys's
voice · 0.31 → 0.12"). That number is the honest answer to "did it work", and it makes
the second pass explainable.

Writer stage gets the same block (guide rules + exemplars + lexicon) when a work has a
voice, so new chapters are written *in* the voice rather than restyled *into* it.

## 4. Multiple styles (up to 5): blend, don't stack layers

The old plan proposed four orthogonal layers (voice/structure/genre/audience). The
built library is flat and that is fine: what users actually want is "*mostly* Chandler,
*some* Didion for description, *a touch* of my own dialogue". Model it as a **blend**:

```json
// <work>/style.json (exists) — add:
{ "voice": "chandler",                         // dominant, exists
  "blend": [
    { "id": "chandler", "weight": 0.6, "facets": ["sentence","rhythm","openers"] },
    { "id": "didion",   "weight": 0.25, "facets": ["description","imagery"] },
    { "id": "me-2024",  "weight": 0.15, "facets": ["dialogue"] }
  ] }
```

Rules: ≤ 5 entries; weights sum to 1; **one entry owns each facet** (facets:
`sentence, rhythm, openers, description, imagery, dialogue, humour, pacing,
punctuation`); the dominant owns anything unassigned. Compilation:

- **Guide**: per facet, take the owner's Do/Don't lines for that facet → one merged
  guide, sections labelled by owner ("Dialogue — from *me-2024*: …").
- **Exemplars**: from each entry, proportional to weight, chosen by facet
  (dialogue exemplar from the dialogue owner).
- **Target fingerprint**: weighted mean of profiles, except facet-owned features,
  which take the owner's value outright (dialogue % from the dialogue owner, etc.).
- Conflicts: if two owners' Do/Don't contradict on the same feature, the higher weight
  wins and the UI shows the dropped rule.

UI: a **Style mixer** in the Voice picker — up to five rows, weight slider, facet
chips; a live "Sample" button restyles one paragraph so the blend can be heard before
it is applied to fourteen chapters. Saving a blend into the library makes it a named
voice like any other (`kind: "blend"`), so blends compose too.

## 5. Style adherence in audit (19)

New deterministic dimension `style-drift`: fingerprint(chapter) vs work target; distance
> τ → warning with the top three gaps as the finding text and a **"Restyle this
section"** action (which is the chunked restyle for one section). This makes voice a
gated property rather than a one-time operation, and catches the Writer drifting back
to house style over a long book.

## 6. Implementation order

| # | Task | Test |
|---|---|---|
| 1 | Fingerprint v2 + distance; re-analyse on read | two known authors' samples: cross-distance ≫ within-distance |
| 2 | Exemplar selection on save (`samples/`), Do/Don't + Signature moves in guide | saved voice has 5 samples, ≥ 8 rules |
| 3 | Chunked restyle with exemplars + preservation check + verify/retry; distance recorded | distance after < before on a test chapter; dialogue lines preserved |
| 4 | Writer stage consumes the same block | new chapter distance within τ |
| 5 | Blend schema + compiler + mixer UI | 3-way blend compiles; facet ownership honoured |
| 6 | `style-drift` audit dimension + section restyle action | drifted chapter flagged with gaps |
