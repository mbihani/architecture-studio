# Architecture Studio — End-to-End Roadmap

> **Status**: Planning document for parallel development by multiple contributors.
> **Last updated**: 2026-08-31
> **Repo**: [github.com/mbihani/architecture-studio](https://github.com/mbihani/architecture-studio)
> **Live app**: https://architecture-studio-7474660648944264.aws.databricksapps.com

---

## Current State (what's built)

- **Reference architecture viewer** — Amr's self-contained HTML app with 63 industry reference architectures (Banking, Healthcare, Retail, etc.) and 139 platform components
- **Editable canvas** — drag/move components, add/remove components, add/remove groups and zones, double-click to edit, component resize, custom connection flows, multi-select + bulk delete, undo, keyboard shortcuts
- **Canvas isolation** — edits stay in "My Canvas", reference architectures are preserved; "Reset to Reference" and "Duplicate Canvas" buttons
- **Industry selector** — searchable dropdown with all 63 industries
- **Left sidebar toolbar** — edit tools in a vertical sidebar, not overlapping the canvas
- **Persistence** — edits saved to localStorage, survive reloads
- **Export/Import** — JSON save/load of the canvas state
- **Tests** — 87 passing (CUJ + architecture + Playwright browser tests)
- **Deployed** — Databricks App on fevm-stable-classic, minimal Node http server (no Express, no Vite, no external runtime deps)

---

## The End-to-End CUJ

```
┌─────────────────────────────────────────────────────────────────────┐
│  STEP 0: Reference Architecture (BUILT ✅)                          │
│  User selects an industry (Banking, Healthcare, Retail, etc.)      │
│  → sees the reference architecture in the editable canvas          │
└──────────────────────┬──────────────────────────────────────────────┘
                       ▼
┌─────────────────────────────────────────────────────────────────────┐
│  STEP 2: Current State Ingestion                                    │
│  User uploads:                                                     │
│  - Current state architecture (image/PDF from account team)        │
│  - Discovery questionnaire (structured responses from account team)│
│  - Functional requirements (from industry vertical team)           │
│  → app parses & extracts components from current state             │
│  → overlays current state onto the reference architecture          │
└──────────────────────┬──────────────────────────────────────────────┘
                       ▼
┌─────────────────────────────────────────────────────────────────────┐
│  STEP 3: AI-Powered Target Architecture                             │
│  Product research agent analyzes:                                   │
│  - Reference architecture (what Databricks recommends)             │
│  - Discovery inputs (customer's current stack, constraints)         │
│  - Functional requirements (what the customer needs)               │
│  - Current state components (what they already have)              │
│  → suggests: add X, remove Y, modify Z, connect A→B               │
│  → user reviews/accepts/edits suggestions                          │
│  → target architecture is formed on the canvas                     │
└──────────────────────┬──────────────────────────────────────────────┘
                       ▼
┌─────────────────────────────────────────────────────────────────────┐
│  STEP 1: Architecture Spec Export                                   │
│  User clicks "Generate Spec"                                       │
│  → app produces a structured .md file with:                         │
│    - All SKUs in the target architecture                           │
│    - How they relate (dependency graph)                            │
│    - How they'll be set up (integration points, prerequisites)     │
│  → .md file passed to demo creation team                           │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Phase 1: Modular Components + .md Spec Export

> **Owner**: Unassigned
> **Status**: Not started
> **Dependencies**: None — builds on existing canvas
> **Effort**: Medium

### Goal

Make all architecture components modular with a formalized SKU model, and add a "Generate Architecture Spec" button that produces a structured `.md` file for the demo creation team.

### What we have

Each component in Amr's data already has rich metadata:
- `n` (name), `s` (subtitle), `d` (description)
- `cap` (capabilities list)
- `rel` / `feeds` / `comps` (relationships)
- `zone` / `group` (placement)
- `cite` (doc citations)

The converter (`converter/`) already normalizes these to stable UUIDs + an explicit edge table.

### Tasks

#### 1a. SKU model formalization

Define a clear "SKU" type for each architecture component — the component metadata that maps to a Databricks product/service:

| Field | Description | Example |
|-------|-------------|---------|
| `sku_id` | Databricks product identifier | `unity-catalog`, `delta-live-tables`, `model-serving` |
| `sku_name` | Human-readable product name | "Unity Catalog" |
| `category` | Platform / Ingestion / Source / Consumer / Use-case | "Platform / Governance" |
| `description` | What it does | "Centralized governance for all data assets" |
| `capabilities` | What it enables | `["Column-level security", "Lineage", "Audit logging"]` |
| `setup_notes` | How it's configured/provisioned | "Enable in workspace → create catalogs → assign schemas" |
| `prerequisites` | What must exist before this SKU | `["Databricks workspace"]` |
| `relationships` | Which other SKUs it connects to and how | `[{target: "delta-live-tables", kind: "feeds"}]` |

This is a data-layer enhancement to the existing component model, not new UI.

#### 1b. .md spec generator

A "Generate Architecture Spec" button that produces a structured markdown document:

```markdown
# Target Architecture: [Industry Name]

## Overview
[Description, industry context, customer requirements summary]

## Architecture Summary
- Total SKUs: N
- Platform components: N
- Data sources: N
- Consumers: N
- Use cases: N

## SKU Inventory

### Platform: Unity Catalog
- **SKU**: unity-catalog
- **Category**: Platform / Governance
- **Description**: Centralized governance for all data assets
- **Capabilities**: Column-level security, lineage, audit logging
- **Prerequisites**: Databricks workspace
- **Connects to**: Delta Live Tables (feeds), Model Serving (feeds)
- **Setup**: Enable in workspace → create catalogs → assign schemas

### [next SKU...]

## Data Flow
[How data moves through the architecture — source → ingestion → platform → consumers]

## Integration Points
[Where the architecture connects to external systems]

## Setup Sequence
[Recommended order of provisioning — dependency-aware topological sort]
1. Databricks workspace
2. Unity Catalog
3. Delta Live Tables
...
```

**Implementation notes**:
- Generated client-side from the canvas state (the `ARCH` data model)
- Includes a dependency-ordered setup sequence (topological sort of the edge graph)
- Downloadable as `.md` file
- The generator is a new JS function that walks `ARCH` data + edge table and emits structured markdown

### Acceptance criteria

- [ ] SKU model defined and documented
- [ ] "Generate Spec" button in the edit toolbar
- [ ] Spec includes all components with their metadata
- [ ] Spec includes relationship graph (data flow section)
- [ ] Spec includes dependency-ordered setup sequence
- [ ] Spec is downloadable as `.md` file
- [ ] Tests cover the spec generation logic

---

## Phase 2: Input Ingestion Panel

> **Owner**: Unassigned
> **Status**: Not started
> **Dependencies**: None — new UI
> **Effort**: Medium

### Goal

Add a "Current State" panel where the user provides inputs from the account and industry vertical teams.

### Tasks

#### 2a. Input ingestion UI

A new panel (accessible from the edit toolbar) with three input sections:

1. **Current state architecture** — upload an image (PNG/JPG) or PDF of the customer's existing architecture diagram
2. **Discovery questionnaire** — structured form or text upload with customer's current stack, data volumes, team structure, compliance requirements, timeline
3. **Functional requirements** — free text from the industry vertical team (use cases, constraints, goals)

**Design questions to resolve**:
- Should the discovery questionnaire be a structured form in the app (dropdowns, text fields) or a freeform text/upload? A structured form gives better agent input but more UI work; freeform is faster to build but less reliable for the agent.
- Should we support a questionnaire template that can be filled out and saved per account?

#### 2b. Input storage

- Inputs are stored alongside the canvas state (in localStorage + exportable JSON)
- Each "project" (canvas + inputs) is a self-contained unit that can be shared/exported

### Acceptance criteria

- [ ] "Current State" panel accessible from the toolbar
- [ ] Image/PDF upload for current state architecture
- [ ] Discovery questionnaire input (structured or freeform — TBD)
- [ ] Functional requirements text input
- [ ] Inputs persist with the canvas state
- [ ] Inputs are included in JSON export/import

---

## Phase 3: Vision-Based Current State Extraction

> **Owner**: Unassigned
> **Status**: Not started
> **Dependencies**: Phase 2 + AI Gateway access
> **Effort**: High

### Goal

Parse the uploaded architecture image/PDF to extract components, connections, and zones using a vision LLM.

### Tasks

#### 3a. Vision LLM extraction pipeline

- Send the uploaded image to a vision LLM (Claude/GPT-4V via AI Gateway)
- Prompt the model to extract:
  - Components (boxes, labels) — name, type, category
  - Connections (arrows, lines) — source, target, direction
  - Zones/layers (groupings) — inferred from spatial layout
- Output: a structured "current state" component list with relationships (JSON)

**Prompt structure** (draft):
```
You are an enterprise architecture analyst. Analyze this architecture diagram and extract:
1. All components (boxes, services, databases, tools) with their names and types
2. All connections (arrows, lines) showing data flow or dependencies
3. Groupings/zones (logical areas like "Data Ingestion", "Analytics", "Security")

Return a JSON object with:
- components: [{name, type, category, description}]
- connections: [{source, target, kind}]
- zones: [{name, components: [names]}]
```

#### 3b. Extraction review UI

- Show extracted components in a review panel before merging
- User can edit/correct extracted names, add missing components, remove false positives
- "Confirm" button commits the extracted current state

### Acceptance criteria

- [ ] Image/PDF sent to vision LLM via AI Gateway
- [ ] Structured JSON returned with components, connections, zones
- [ ] Review panel shows extraction results
- [ ] User can edit extraction before confirming
- [ ] Confirmed current state stored as structured data
- [ ] Error handling for unclear/unparseable diagrams

---

## Phase 4: Augmentation Logic + Visual Diff

> **Owner**: Unassigned
> **Status**: Not started
> **Dependencies**: Phase 3
> **Effort**: High

### Goal

Overlay the extracted current state onto the reference architecture with visual differentiation.

### Tasks

#### 4a. Component matching

- Match current state components to reference architecture components by:
  - Name similarity (fuzzy match)
  - Category/type match
  - Functional equivalence (e.g., "Informatica PowerCenter" ≈ "Delta Live Tables" for ETL)
- Three match states:
  - **Match** — current state component maps to a reference component → "already have"
  - **Gap** — reference component NOT in current state → "recommended addition"
  - **Legacy** — current component NOT in reference → "to be migrated/replaced"

#### 4b. Visual diff rendering

- Canvas shows all three states with visual differentiation:
  - 🟢 Green = existing (already in current state)
  - 🔵 Blue = recommended (in reference, not in current state)
  - ⚫ Grey = legacy (in current state, not in reference)
- Toggle controls: "Show current state", "Show gaps", "Show legacy"
- The diff view is the starting point for Step 3 (AI suggestions)

#### 4c. Manual augmentation

- User can manually add/remove/modify components in the diff view
- "Accept all recommended" button to add all blue components
- "Keep all legacy" button to retain grey components

### Acceptance criteria

- [ ] Component matching algorithm (fuzzy name + category match)
- [ ] Visual diff with three color states
- [ ] Toggle controls for each state
- [ ] Manual accept/reject of individual components
- [ ] Bulk accept/reject actions
- [ ] Diff state persists with the canvas

---

## Phase 5: Product Research Agent Integration

> **Owner**: Unassigned
> **Status**: Not started
> **Dependencies**: Phase 4 + AI Gateway
> **Effort**: Medium-High

### Goal

An AI agent analyzes the gap between current state and reference architecture, considers discovery inputs and functional requirements, and suggests changes to form the target architecture.

### Background

We previously built a Product Research Agent in the fe-india-os repo. Its key insight was "direct LLM calls, not Genie" — it killed Genie's 306s latency by swapping to direct LLM knowledge calls. We carry that forward here.

**Recommendation**: Embed the agent logic in the architecture studio backend (direct LLM call via AI Gateway). No cross-workspace dependency, no separate app to maintain.

### Tasks

#### 5a. Agent input contract

The agent receives a structured prompt with:
- Reference architecture (component list + relationships, as JSON)
- Current state (extracted components, as JSON)
- Discovery questionnaire responses (structured text)
- Functional requirements (free text from industry vertical team)

#### 5b. Agent reasoning + suggestions

The agent produces structured suggestions:

```json
{
  "suggestions": [
    {
      "action": "add",
      "component": "Delta Live Tables",
      "reason": "Customer needs streaming ingestion from Kafka; DLT handles CDC with minimal code",
      "priority": "high",
      "replaces": ["Informatica PowerCenter"],
      "setup_notes": "Configure DLT pipeline with Kafka source, medal architecture (bronze→silver→gold)"
    },
    {
      "action": "remove",
      "component": "Informatica PowerCenter",
      "reason": "Legacy ETL tool; DLT replaces this function with lower TCO",
      "priority": "high"
    },
    {
      "action": "modify",
      "component": "Unity Catalog",
      "reason": "Customer has 50+ databases; enable column-level security and row-level filters",
      "modifications": ["Enable column masking", "Create 5 catalogs by business domain"],
      "priority": "medium"
    }
  ]
}
```

#### 5c. Suggestion review UI

A "Review AI Suggestions" panel that shows each suggestion with:
- The action (add/remove/modify)
- The reasoning
- The priority (high/medium/low)
- Accept / Reject / Edit buttons

Accepted suggestions are applied to the canvas (components added/removed/modified). The canvas now shows the **target architecture** — reference + accepted modifications.

#### 5d. Backend LLM call

- Studio backend makes an AI Gateway call with the structured prompt
- Per build standards: AI Gateway is the sole LLM route (ChatOpenAI @ unified-URL, FMAPI model name, per-request fresh SP token)
- The judge/agent is called directly (not through `make_judge`)
- MLflow tracing is best-effort (guard-wrapped)

### Acceptance criteria

- [ ] Agent receives all four inputs (reference, current state, discovery, requirements)
- [ ] Agent returns structured suggestions with actions and reasoning
- [ ] Review panel shows all suggestions with accept/reject/edit
- [ ] Accepted suggestions applied to canvas
- [ ] Canvas shows target architecture after all suggestions processed
- [ ] LLM call routed through AI Gateway
- [ ] Error handling for agent failures (timeout, invalid response)

---

## Phase 6: End-to-End Polish

> **Owner**: Unassigned
> **Status**: Not started
> **Dependencies**: All phases
> **Effort**: Medium

### Tasks

- The full flow: select reference → upload current state → AI suggestions → target architecture → generate spec
- Project save/load (all inputs + canvas state as a single shareable file)
- Multi-project support (work on multiple accounts/customers)
- Polish: loading states, error messages, empty states, progress indicators
- Documentation: user guide for the full workflow

### Acceptance criteria

- [ ] End-to-end flow works without errors
- [ ] Project can be saved/loaded/exported/imported
- [ ] Loading and error states for all async operations
- [ ] User documentation

---

## Technical Decisions (open questions)

### 1. AI Gateway access

Steps 3 and 5 both need LLM calls (vision for extraction, reasoning for suggestions). Per build standards, AI Gateway is the sole LLM route.

**Question**: Is there a service principal with gateway access on the fevm-stable-classic workspace?

### 2. Discovery questionnaire format

Should the discovery questionnaire be:
- **A) Structured form** in the app (dropdowns, text fields) — better agent input, more UI work
- **B) Freeform text/upload** — faster to build, less reliable for the agent
- **C) Hybrid** — structured template with freeform fields

### 3. Product research agent deployment

- **A) Embed in the studio backend** (recommended) — direct LLM call via AI Gateway, no cross-workspace dependency
- **B) Call the existing fe-india-os product research agent** — had cross-workspace 401 issues per prior work

### 4. SKU mapping

- **A) Canonical Databricks SKU IDs** (e.g., "Unity Catalog" → `unity-catalog`) — more actionable for demo team, requires lookup table
- **B) Component names as-is** — simpler, less actionable

---

## Architecture (current)

```
architecture-studio/
├── index.html              # Self-contained app (18,766 lines, Amr's base + editing surface)
├── server.mjs              # Minimal Node http server (serves static files + API routes)
├── run.sh                  # Build + start script for Databricks Apps
├── app.yaml                # Databricks App config
├── .databricksignore       # Exclude node_modules, dist, etc.
├── converter/              # Amr's ARCH + INDUSTRIES → ArchitectureDoc JSON
│   ├── index.py
│   ├── map_to_drawio.py
│   ├── parse_arch.py
│   ├── parse_industries.py
│   └── common.py
├── tests/
│   ├── cuj.test.mjs        # 79 CUJ tests
│   ├── architecture.test.mjs  # 8 architecture tests
│   └── playwright/
│       └── studio.spec.cjs  # 18 browser tests
├── docs/
│   └── ROADMAP.md          # This file
└── package.json            # Node test runner, Playwright
```

## Deployment

- **Workspace**: fevm-stable-classic (AWS us-east-1)
- **App name**: `architecture-studio`
- **URL**: https://architecture-studio-7474660648944264.aws.databricksapps.com
- **Source**: `/Workspace/Users/mayanck.bihani@databricks.com/architecture-studio-app`
- **Server**: `server.mjs` (minimal Node http, no Express/Vite)
- **Profile**: `fevm-stable-classic`

### Deploy commands

```bash
# Upload updated source
databricks workspace import /Workspace/Users/mayanck.bihani@databricks.com/architecture-studio-app/index.html \
  --file index.html --format RAW --overwrite --profile fevm-stable-classic

# Deploy
databricks apps deploy architecture-studio \
  --source-code-path /Workspace/Users/mayanck.bihani@databricks.com/architecture-studio-app \
  --profile fevm-stable-classic

# Check status
databricks apps get architecture-studio --profile fevm-stable-classic
```

### Run locally

```bash
cd ~/architecture-studio
node server.mjs   # serves on http://localhost:8080
```

### Run tests

```bash
# Node tests
node --test tests/cuj.test.mjs tests/architecture.test.mjs

# Playwright browser tests (requires local server running)
npx playwright test --config tests/playwright/playwright.config.cjs
```
