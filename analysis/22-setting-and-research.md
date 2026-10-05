# 22 — Setting & Research: Time, Place, Culture as First-Class Inputs

> New plan (2026-09-07). Verified against `vendor/studio/packages/core/src`:
> `models/book-rules.ts:20-24` (`eraConstraints {enabled, period, region}`),
> `models/genre-profile.ts:12` (`eraResearch` flag), `agents/architect.ts:141,438,570`
> (era anchor woven into `story_frame`; "Era Constraints" section of `book_rules`),
> `agents/continuity.ts:171-175,337,458-461` (dimension 12 "era" enabled when
> `eraResearch || eraConstraints.enabled`; auditor may call `search_web`/`fetch_url`),
> `productions/registry.ts:262` (`research` stage exists for `publication` only),
> `models/input-governance.ts:122` (SQLite FTS5/BM25 retrieval already in the engine).

## Status (2026-09-11)

**Done:** §1 the artefact (`setting/` with `setting.json`, `bible.md`,
`lexicon.json`, `sources.jsonl`, `cards/`), §2 Door A (pin from the card) and
Door B (ask once, `setting/ask.json`) and Door C (the `settings/` library), §3
`content.research` on every type, §4 the Setting Card in the Writer, dimension 12
auto-enabled, the deterministic anachronism pass, the ArtDirector consuming
setting and the restyle keeping period words, §5 the Setting card on the audit
screen, §8 Series (`series/`, shared world and setting, promise ledger).

**Not done:** per-character `speech` in the roles truth file (§4), the Setting
library page as its own screen, taste scope `setting` (§6), the Series shelf on
Home.

## The problem, precisely

Today the *setting* of a work is a two-field afterthought (`period`, `region`) that
exists for **books only**, is written by the Architect from memory, is read by exactly
one audit dimension, and never reaches the Writer as concrete material. A story set in
Kolkata in 1943 gets the year in `story_frame` and nothing else: no period objects, no
speech register, no prices, no street names, no anachronism list. The Writer invents
from training-data averages, which is exactly the "AI-flavoured" texture the destyle
pass then tries to scrub off. This is the wrong order: **research in, slop out** is
cheaper and more authentic than **generic in, scrub after**.

The user's requirement: the Researcher + Writer combination must adapt culture, way of
speaking, objects, money, food, technology, social norms from the chosen time and place
— centrally, for every production type, with the user able to give the time and place
as variables.

## 1. The artefact: a Setting Bible

One folder per work (any type), same shape everywhere:

```
<outDir>/<id>/setting/
  setting.json        machine spec — the variables
  bible.md            the researched material, sectioned (see below)
  lexicon.json        register + idiom + anachronism lists (deterministic, audit-consumable)
  sources.jsonl       every claim's source URL + fetched date (fact-check reuse)
  cards/<unit>.md     per-chapter "Setting Card" slices (generated, ≤600 tokens)
```

```json
// setting.json
{
  "version": 1,
  "enabled": true,
  "kind": "historical",            // historical | contemporary | speculative | secondary-world
  "place": { "name": "Kolkata", "then": "Calcutta", "country": "India", "scale": "city" },
  "time":  { "from": "1943-01", "to": "1943-12", "label": "Bengal famine year" },
  "lens":  { "class": "lower-middle clerical", "community": "Bengali Hindu", "language": "Bengali, English officialese" },
  "speech": { "register": "formal address to elders; British-Indian officialese in offices", "dialectNotes": [] },
  "fidelity": "strict",            // strict | flavour | loose — how hard the audit bites
  "reuseOf": null                  // id of a library setting this was cloned from
}
```

`bible.md` sections (fixed headings so slices can be retrieved by name):

1. **Daily life & objects** — what is in a kitchen, a pocket, a street; brands, tools,
   clothes, transport. Concrete nouns the Writer may use.
2. **Money, prices & work** — currency, typical wages, what a meal/rent/ticket costs.
3. **Speech & register** — forms of address, honorifics, code-switching, idioms with
   gloss, taboo words, how different classes/communities talk to each other.
4. **Social norms & institutions** — family, religion, caste/class, gender, law,
   schooling, what is scandalous, what is invisible.
5. **Technology & media** — what exists, what is new, what is unaffordable.
6. **Place & senses** — geography, neighbourhoods, weather by month, smells, sounds,
   light. Named real streets/landmarks with one-line notes.
7. **Calendar** — real events inside the time window, festivals, seasons, news.
8. **Anachronism blacklist** — objects, words, attitudes that did NOT exist yet or
   had died out (feeds `lexicon.json.forbidden`).
9. **Open questions** — what the Researcher could not verify (shown to the user).

`lexicon.json`:
```json
{ "prefer": [{"term":"tram","for":"streetcar"}, {"term":"dada","gloss":"elder brother, also respectful address"}],
  "forbidden": [{"term":"okay","reason":"Americanism, rare in 1943 Bengali speech"}, {"term":"plastic bag","reason":"not until 1960s"}],
  "addressForms": [{"speaker":"child","to":"father","form":"Baba"}],
  "currency": {"unit":"rupee","sub":"anna (16/rupee), pice"} }
```

## 2. How the user gives time and place (three doors, one schema)

**Door A — structured fields at creation.** Every creation form (book, short, script,
storybook, storyboard, magazine feature) gets a collapsed *"Where and when"* block:
Place · Time (free text, parsed to the schema by a cheap model) · Lens (optional) ·
Fidelity (strict/flavour/loose). Empty is allowed and means "not pinned".

**Door B — the agent asks, once, prefilled.** When the fields are empty and the prompt
or the Architect's draft mentions a real place/period/event (detector: cheap model on
the intake text + `story_frame`, returns `{place?, time?, confidence}`), the pipeline
**pauses before writing** and raises a `setting` clarification card:

> *This looks set in Calcutta, around 1943. Should I research that world before
> writing? — [Yes, research it] [Different place/time…] [No, keep it loose]*

Rules: ask **only once per work**, only when confidence ≥ 0.6, never for
`secondary-world` genres (cultivation, high fantasy — the Architect prompt already
says "do not fabricate an era anchor" there), and the answer is written to
`setting.json` so nothing asks again. This is the same `propose_action` → card →
confirm mechanism the app already uses for production tools, so it is one more card,
not a new interaction model.

**Door C — the Setting Library.** `<workspace>/settings/<id>/` mirrors the style
library (`styles/<id>/`, `pipeline/style-library.ts`): a researched bible is
reusable across works (`@setting:calcutta-1943` in any prompt, or a picker in the
creation form). A series set in one world researches once.

## 3. The stage: `content.research` for every type

Today `research` is a magazine-only stage. Make it a **conditional stage on every
type** in `registry.ts` — present in the graph, skipped when `setting.enabled=false`:

| Type | Research runs when | Output used by |
|---|---|---|
| book, short, translation | setting pinned | Architect (story_frame), Writer (cards), Auditor (dim 12 + lexicon) |
| script, storyboard, interactive-film | setting pinned | Writer (dialogue register), ArtDirector (props/costume) |
| storybook | setting pinned | Writer (objects a child would see), ArtDirector (world) |
| publication | always (exists) | + feature-level settings for historical/travel pieces |

The **Researcher agent** (roster already lists a Researcher job, `agent-roster.ts`) gets
the tools the Auditor already has (`search_web`, `fetch_url`) and a fixed procedure:

1. Expand the setting into ~25 queries from a template per bible section
   ("Calcutta 1943 street food prices", "Bengali honorifics 1940s", …).
2. Fetch, extract, write each section with **inline source ids**; append
   `sources.jsonl`. Minimum two sources for any number, date, or price.
3. Build `lexicon.json` from sections 3 and 8.
4. Write section 9 honestly. The card shown to the user lists the open questions and
   lets them answer or ignore — user knowledge is a source too (recorded as
   `source: "user"`).
5. Gate: the bible is a **content-gate artefact**. The user can read/edit it before
   writing starts (it is markdown; the Audit screen's reading pane can show it).

Budget: one research run ≈ 25 searches + ~40k tokens. Cache by
`(place, time window)` hash in the library so reruns are free.

## 4. Injection: how it reaches each agent

**Writer — the Setting Card, not the bible.** The full bible is 5–15k tokens and
would drown the chapter plan. Per unit, build `cards/<unit>.md` (≤600 tokens):

```
SETTING CARD — Calcutta, Aug 1943 · strict
Scene needs (from chapter plan): office, monsoon, a bribe, a tram ride
Objects: punkah, blotting paper, anna coins, jute sacks, hurricane lamp, dhoti+shirt for clerks …
Speech: clerks say "Sir" to British officers, "babu" between peers; children → "Baba/Ma"; no "okay"
Money: clerk earns ~₹40/month; tram fare 1 anna; rice ~₹20/maund (famine price, 4× normal)
Senses: monsoon mould smell in files, tram bells, crows, kerosene
Do not: plastic, ballpoint pens, "Kolkata", nylon, "hi"
```

Selection is retrieval, not summarisation: the chapter plan's keywords query the
bible sections through the FTS5 index the engine already has (`input-governance.ts`),
then a cheap model compresses hits into the card. The card is one more system block
in the Writer's prompt, placed after style and before the plan.

**Dialogue register per character.** `roles` (the cast truth file) gains
`speech: {register, addressForms, tics}` seeded from lexicon + lens per character; the
Writer prompt renders it under each speaking character. This is what makes a 1943
clerk and his British superior sound different without the model guessing.

**Auditor.** Dimension 12 is enabled automatically when a setting is pinned (today it
needs the genre flag). `lexicon.forbidden` becomes a **deterministic anachronism
pass** in the same slot as `ai-tells.ts` (offset findings, `anachronism/<term>`), so
it costs no tokens and is exact. Fidelity `strict` → blocking, `flavour` → warning,
`loose` → note. Findings carry the bible source so "why is this wrong" is one click.

**ArtDirector (08/09).** `setting.json` + bible sections 1 and 6 seed the design
world: period props, palette (from section 6), costume and technology cues in every
image brief, and the anachronism list goes into the negative prompt. Cover and plates
stop showing the wrong century.

**Destyler.** Receives `lexicon.prefer` so de-AI rewrites do not replace a period
word with a modern generic one.

**Fact-check (magazine, exists).** Reads `sources.jsonl` first — claims already
sourced by research are not re-searched.

## 5. UI

- Creation forms: the collapsed "Where and when" block (Door A).
- Run screen: the `setting` clarification card (Door B) in the same slot as gate
  cards; research progress shows as job steps ("searching · 12/25").
- Audit screen: a **Setting** tab beside the manuscript showing the bible with
  section jump-links, open questions as an inline form, and the lexicon as editable
  chips (add a forbidden term → next audit catches it).
- Settings library page: list, rename, duplicate, "used by N works".

## 6. Learning (ties to 18)

Every accepted/ignored anachronism finding and every user edit to `bible.md` or the
lexicon is a taste event with `scope: "setting"`. Distillation proposes lexicon deltas
and — across works sharing a library setting — promotes them to the library entry.
A setting gets more accurate the more it is written in.

## 8. Series: memory across works (added 2026-09-07; sellable feature 11 #2)

A setting library entry is already "one world, many works". A **Series** is that plus
the cast, the design world, and the promises — a first-class object:

```
<workspace>/series/<id>/
  series.json     { title, works: [{type,id,order}], timeline: [{workId, from, to}] }
  setting/        the shared bible (works link to it via setting.json.reuseOf)
  cast/           shared roles truth file + design cast sheets (08 §9), with per-work
                  deltas: { characterId, asOf: workId, age, status, wardrobe }
  design/         shared world.json (works may override technique, never palette/type)
  ledger.json     cross-work promises: hooks opened in one work, where they pay off
  style.json      the series voice/blend (05 §4) — works inherit unless overridden
```

- **Create**: "New in series…" on any creation form, or "Start a series from this
  book" on a finished work (moves its setting/cast/world up one level, leaves links).
- **Continuity across works**: the Architect for work N receives the series ledger
  and the cast state *as of* the previous work; the Auditor gains dimension
  `series-continuity` (a promoted hook open at the end of work N-1 must be
  acknowledged or paid in work N; a character's status may not regress). This is the
  book-level `hook debt` logic (`continuity.ts:213-217`) lifted one scope up.
- **Ageing**: `timeline` gives each work a date span; the cast delta at that date is
  what the Writer and the Cast Sheet see, so a child in book 1 is a teenager in book 4
  on the page *and* in the pictures.
- **UI**: a Series shelf on Home (works in order, shared bible/cast/world cards),
  and the ledger as a table with "paid in" links.

## 7. Implementation order

| # | Task | Test |
|---|---|---|
| 1 | `setting.json` + `bible.md` schema, loader, library dir; migrate `eraConstraints` → `setting.json` (keep reading the old field) | existing books load unchanged |
| 2 | `content.research` in registry for all types, conditional; Researcher procedure + `sources.jsonl` | pinned short → bible with 9 sections, ≥2 sources per number |
| 3 | Setting Card builder (FTS5 retrieval + compress) → Writer prompt block | card ≤600 tokens, contains plan keywords' objects |
| 4 | Deterministic anachronism pass + dim 12 auto-enable + fidelity→severity | "plastic bag" in 1943 → blocking finding with offset |
| 5 | Door B detector + clarification card; Door A fields | prompt "a clerk in Calcutta 1943" → card appears once |
| 6 | Character `speech` in roles + Writer rendering | two characters with different address forms in output |
| 7 | ArtDirector consumes setting (needs 08 §ArtPolicy) | brief negatives include anachronisms |
| 8 | Setting tab UI, library page | edit lexicon → next audit reflects it |
| 9 | Taste scope `setting` (after 18 exists) | ignored finding ×5 → proposal |
| 10 | **Series** (§8): `series/` layout, inherit setting/cast/world/style, ledger, `series-continuity` dimension, Series shelf | book 2 created in a series: Architect prompt contains book 1's open promoted hooks; audit flags an unacknowledged one |
