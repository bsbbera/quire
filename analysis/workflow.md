# Quire — Master Workflow Diagram

> The improved version of the hand-drawn workflow (2026-09-01), consistent with
> plans 14 (pipeline), 15/20/21 (model/harness/agents), 19 (audit), 18 (taste),
> 09 (images), 04 (gallery). Updated 2026-09-10: design.system + Section board /
> World card (world + Design Kit approved before build, 07 §1b), engine router with
> Canva ↔ Comfy fallback (23), `final/` + Learn-from-final loop (04 §6). Renders with Mermaid.

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
    SET{{"setting card (22)<br/>place · time · lens — asked once"}}:::gate
    RES["research → Setting Bible (22)<br/>(all types when pinned; magazine always)"]:::stage
    SET --> RES
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
    POL["artPolicy per type (08 §1)<br/>surfaces · realism · imagesPerUnit"]:::aux
    SYS["design.system (08 §2, 07 §1b)<br/>skills first → world + <b>Design Kit</b><br/>(per section for magazine)"]:::stage
    GK{{"Section board / World card<br/>approve world + kit + opener<br/>(design finalised before build)"}}:::gate
    AD["ArtDirector (08 §4)<br/>design skill → slots + page specs (design-skill §11, §13)<br/>illustration skill → asset graph: generate / extract / edit nodes (illustration-skill §4b, 09 §0)"]:::stage
    POL --> SYS --> GK --> AD
    REFS["web references<br/>(art/refs, IPAdapter)"]:::aux
    ENG{"engine router (23 §3)<br/>caps + quota"}:::aux
    GEN["ImageSmith → ComfyUI<br/>workflow + recipe sidecar (04)"]:::stage
    CANVA["Canva AI (Pro)<br/>→ export PNG · sidecar"]:::stage
    CUT["post-process<br/>rembg / Affinity AI Studio cutouts · alpha bleeds"]:::stage
    DA["DesignAuditor pre-screen<br/>(scorePage: design-skill §12b, cause-routed auto-redo ≤2; spec-lint + asset-check upstream, 09 §0.3b)"]:::stage
    GAL["Gallery (04)<br/>approve · redesign · delete"]:::aux
    AD --> ENG
    ENG -- "refs/inpaint/seed or quota out" --> GEN
    ENG -- "spot/ornament/texture, allowance left" --> CANVA
    CANVA -. "allowance error → fallback" .-> GEN
    GEN --> CUT
    CANVA --> CUT
    CUT --> DA --> GAL
    REFS -.-> GEN
    GAL -- "redesign w/ new style note" --> AD
  end

  G1 -- "auto-advance (14)" --> SYS
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
  G3 -. "optional" .-> DERIV["build.derivatives (23 §6)<br/>Canva promo set · resize · export"]:::aux
  G3 --> FINAL["final/ (04 §6)<br/>user's afdesign · pdf · md"]:::aux
  FINAL -- "Learn from final (manual)" --> LEARN["taste.ingestFinal<br/>text diff · kit read-back · pdf diff"]:::stage

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
  G1{{"Gate 1 verdicts + cause chips<br/>+ audit finding verdicts"}}:::gate
  G2{{"Gate 2 verdicts + cause chips<br/>+ spec/image diffs"}}:::gate
  G3{{"Gate 3 verdicts"}}:::gate
  FIN{{"final/ + Learn from final (04 §6)<br/>text diff · afdesign read-back · pdf diff<br/>weighted ×3"}}:::gate

  FEED["_taste/feedback.jsonl<br/>(capture, 18 §1)"]:::stage
  DISTILL["distill job<br/>(cheap model, ≤5 rules, evidence)"]:::stage
  APPROVE{{"Taste tab<br/>accept · edit · ignore<br/>(never silent)"}}:::gate

  G1 --> FEED
  G2 --> FEED
  G3 --> FEED
  FIN --> FEED
  FEED --> DISTILL --> APPROVE
  FIN -- "new assets as drafts" --> KIT["Design Kits (07 §1b)<br/>gradients · patterns · vectors · FX · type styles"]:::final

  APPROVE --> SP["Style packs (05)<br/>voice rules"]:::final
  APPROVE --> AP["Audit packs (19)<br/>dimensions · thresholds · bench guard"]:::final
  APPROVE --> WR["Worlds (08)<br/>math + prompt rules"]:::final
  APPROVE --> KIT
  APPROVE --> SK["Skills (17)<br/>rules.jsonl"]:::final
  KIT -. "next build places, never redraws" .-> G2

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
