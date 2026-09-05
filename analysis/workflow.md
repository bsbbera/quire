# Quire — Master Workflow Diagram

> The improved version of the hand-drawn workflow (2026-09-01), consistent with
> plans 14 (pipeline), 15/20/21 (model/harness/agents), 19 (audit), 18 (taste),
> 09 (images), 04 (gallery). Renders with Mermaid.

## 1. The macro pipeline (same for every type; sub-stages vary per type)

```mermaid
flowchart TB
  subgraph MODEL["MODEL PLANE (15/20/21) — profile→model routing, one provider seam"]
    LLM(("LLM<br/>per-agent model")):::model
    TOOLS["Tools · Skills · Search · MCP<br/>(scoped per stage)"]:::model
    LLM <--> TOOLS
  end

  USER[/"User prompt + intake<br/>(type, style packs, world, extent)"/]:::user
  TYPE{"Type registry (14 §1.1)<br/>book · story · short · script ·<br/>storyboard · film · play · magazine"}:::gatebox

  USER --> TYPE

  subgraph CONTENT["CONTENT (per-type sub-stages)"]
    direction TB
    RES["research + fact-check<br/>(magazine only)"]:::stage
    PLAN["plan<br/>(Architect / Planner / flatplan)"]:::stage
    WRITE["write<br/>(Writer — style packs 05)"]:::stage
    AUDIT["audit<br/>(Auditor — audit packs 19)"]:::stage
    DESTYLE["destyle / de-AI pass<br/>(Destyler — slop score)"]:::stage
    RES --> PLAN --> WRITE --> AUDIT --> DESTYLE
    AUDIT -. "issues → revise<br/>(Reviser, ≤ maxIterations)" .-> WRITE
  end

  TYPE --> CONTENT
  DESTYLE --> G1{{"GATE 1 · CONTENT<br/>approve / reject / withdraw ↺"}}:::gate
  G1 -- "reject unit (note)" --> WRITE

  subgraph DESIGN["DESIGN (skipped for script/translation)"]
    direction TB
    AD["ArtDirector (21)<br/>content + world (08) →<br/>briefs: slot × treatment (09)<br/>page specs (magazine 13)"]:::stage
    REFS["web references<br/>(art/refs, IPAdapter)"]:::aux
    GEN["ImageSmith → ComfyUI<br/>workflow + recipe sidecar (04)"]:::stage
    CUT["post-process<br/>rembg cutouts · alpha bleeds"]:::stage
    DA["DesignAuditor pre-screen<br/>(rules 06, auto-redo ≤2)"]:::stage
    GAL["Gallery (04)<br/>approve · redesign · delete"]:::aux
    AD --> GEN --> CUT --> DA --> GAL
    REFS -.-> GEN
    GAL -- "redesign w/ new style note" --> AD
  end

  G1 -- "auto-advance (14)" --> AD
  GAL --> G2{{"GATE 2 · DESIGN<br/>😍 keep · 🔁 redesign · 🎨 re-world · ✏️ tweak<br/>withdraw ↺"}}:::gate
  G2 -- "reason: content → reopen unit" --> WRITE
  G2 -- "redo" --> AD

  subgraph BUILD["BUILD — one flow, three shapes (14 §1.1b)"]
    direction TB
    PAGE["page-shaped<br/>magazine · storyboard · storybook<br/>Affinity flatplan + TK (07)"]:::stage
    REFLOW["reflow-shaped<br/>book · short · translation<br/>Affinity autoflow / Typst + EPUB"]:::stage
    NOTP["not-paper<br/>film · play → HTML<br/>script → Fountain PDF"]:::stage
  end

  G2 -- "auto-advance" --> BUILD
  BUILD --> G3{{"GATE 3 · BUILD<br/>approve PDF/EPUB · withdraw ↺"}}:::gate
  G3 --> READER["READER (10)<br/>flipbook / reflow · share export"]:::final

  MODEL -.- CONTENT
  MODEL -.- DESIGN
  MODEL -.- BUILD

  classDef user fill:#DE5140,stroke:none,color:#fff
  classDef model fill:#2A2724,stroke:#DE5140,color:#F0EAE3
  classDef stage fill:#FAF7F3,stroke:#8B8078,color:#23201D
  classDef aux fill:#E7DFD7,stroke:#8B8078,color:#23201D,stroke-dasharray:4 3
  classDef gate fill:#DE5140,stroke:none,color:#fff
  classDef gatebox fill:#2A2724,stroke:none,color:#F0EAE3
  classDef final fill:#2A2724,stroke:#DE5140,color:#F0EAE3
```

Key properties (what the arrows enforce):

- **Auto-advance (14):** approving the last unit at a gate *starts* the next stage;
  the last artifact landing *opens* the next gate. No dead ends between stages.
- **Withdraw ↺ on every gate:** reopens editing, preserves counters/history,
  marks downstream artifacts stale, cancels running downstream jobs (14 §2.1).
- **Same flow, different bodies:** magazine differs only inside the boxes
  (per-page briefs/specs, beauty gate at spread size); books differ by image count
  (openers/tailpieces/plates) and reflow build — the gates never differ.

## 2. The learning loops (every gate feeds something)

```mermaid
flowchart LR
  G1{{"Gate 1 verdicts<br/>+ audit finding verdicts"}}:::gate
  G2{{"Gate 2 verdicts<br/>+ spec/image diffs"}}:::gate
  G3{{"Gate 3 + hand-edits<br/>in Affinity/chapters"}}:::gate

  FEED["_taste/feedback.jsonl<br/>(capture, 18 §1)"]:::stage
  DISTILL["distill job<br/>(cheap model, ≤5 rules, evidence)"]:::stage
  APPROVE{{"Taste tab<br/>accept · edit · ignore<br/>(never silent)"}}:::gate

  G1 --> FEED
  G2 --> FEED
  G3 --> FEED
  FEED --> DISTILL --> APPROVE

  APPROVE --> SP["Style packs (05)<br/>voice rules"]:::final
  APPROVE --> AP["Audit packs (19)<br/>dimensions · thresholds · bench guard"]:::final
  APPROVE --> WR["Worlds (08)<br/>math + prompt rules"]:::final
  APPROVE --> SK["Skills (17)<br/>rules.jsonl"]:::final

  SP -. "next unit's prompts" .-> G1
  AP -. "next audit run" .-> G1
  WR -. "next briefs/specs" .-> G2
  SK -. "next stage context" .-> G1

  classDef stage fill:#FAF7F3,stroke:#8B8078,color:#23201D
  classDef gate fill:#DE5140,stroke:none,color:#fff
  classDef final fill:#2A2724,stroke:#DE5140,color:#F0EAE3
```

## 3. Diffs vs the hand-drawn original

1. **Gates drawn explicitly** — the three approval diamonds (with withdraw) are the
   control surface; the original flowed Content→Image→Affinity without them.
2. **Audit is inside Content**, not a separate satellite — and it learns via audit
   packs (19), so "Style and Skill Improvement" feeds audit too, not only writing.
3. **Design System box became two things**: Worlds (08, the data) and the
   ArtDirector/DesignAuditor agents (21, the users of it); feedback reaches worlds
   through the Taste tab, never directly.
4. **Affinity split into three build shapes** — the original had one Affinity node;
   books/shorts need the reflow script, script/film/play never touch Affinity.
5. **Gallery + reference dumping** added between generation and the design gate.
6. **Model plane routes per agent** (profiles = agent names, 21), not one global LLM.
```
