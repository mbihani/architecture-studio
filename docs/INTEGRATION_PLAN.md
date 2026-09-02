# Integration Plan — Architecture Studio × Product Research Agent

> **Status**: Active build plan (supersedes ROADMAP.md Phase 5 direction on deployment).
> **Last updated**: 2026-09-02
> **Repos**: [architecture-studio](https://github.com/mbihani/architecture-studio) · [product-research-agent](https://github.com/mbihani/product-research-agent)
> **Workspace**: both apps deployed in `fevm-india-feos` (co-located).

---

## 1. Goal (the customer-use-case CUJ)

Four inputs converge to produce a **customer-use-case-specific target architecture** on the studio canvas:

1. **Reference architecture** — from Architecture Studio (`ARCH`/`INDUSTRIES`, e.g. Banking).
2. **Customer current-state architecture** — from the account team (a diagram image/PDF).
3. **Customer discovery notes** — from the account team (structured discovery pack).
4. **Industry functional requirements** — from the industry-vertical team (a POV/requirements doc).

The **Product Research Agent** reasons over all four (diff current↔reference, satisfy the field requirements) and returns apply-ready `suggestions[]`. The studio renders them for accept/reject/edit and **applies accepted ones to the canvas**.

```
STUDIO (browser: index.html)                                   AGENT (FastAPI, same workspace)
 (1) Banking reference board (boardSnapshot)
 (2) Upload current-state PNG ───────────── fetch ──────────▶ POST /api/studio/extract  (NEW, vision)
                            ◀──────────────────────────────── {components, edges, zones}
 (2') Review extracted current-state → confirm
 (3) Discovery JSON   (4) Field-requirements markdown
        │  FORMAT BRIDGE: boardSnapshot → {components,edges}+_uid, card_library dump
        ▼
 all 4 inputs ────────────────────────────  fetch ─────────▶ POST /api/studio/suggest  (DONE)
                            ◀──────────────────────────────── suggestions[] + summary + diff_stats
 (5) Review panel (accept/reject/edit)
 (6) Apply accepted → addTile / splice / openEdit → persistCustom(); build()
     = customer-specific target architecture on the canvas
```

---

## 2. What already exists (do not rebuild)

- **`POST /api/studio/suggest`** on the agent is **built and verified** (~47–73s): plain JSON in/out, all-optional tolerant inputs, SP-token auth, structured-output + deterministic backfill. Contract in `product-research-agent/docs/STUDIO_INTEGRATION.md`.
- The agent's normalizer (`_normalize_arch`) accepts **Lucid-pages**, **semantic `{components,edges}`**, or **simple `{components,connections}`** — the studio targets the **semantic** shape.

## 3. Ground-truth corrections (docs were stale)

- The **deployed** studio is the self-contained `index.html` (custom **HTML/CSS/SVG** canvas) + a **static-only** `server.mjs`. It is **not** draw.io, **not** Lucid, and has **no backend API or AI code** today. `ARCHITECTURE.md` (React/Express/Lucid) describes an *unshipped* design.
- Studio native export = `boardSnapshot()` → `{schema:26, industry, bands[], rails{src,ing,ppl,cons}, top, cloud}`. Tiles carry `n,s,ic,st,long,caps,rel` and **no stable IDs** → we inject `_uid`.
- The agent's normalizer does **not** understand `{bands,rails,top,cloud}` → the **format bridge** (WS-A) is the linchpin.

---

## 4. Decisions (locked)

| # | Decision | Consequence |
|---|----------|-------------|
| 1 | **Current-state extraction: vision, now.** | New agent endpoint `POST /api/studio/extract` (Claude vision via AI Gateway) + a studio extraction-review UI. |
| 2 | **Inject a persisted `_uid` per tile.** | `component_id` round-trips to the exact canvas node on apply; name-match is only a fallback. |
| 3 | **Call path: client-side fetch for now, `server.mjs` proxy fallback shipped alongside.** | See §5 — co-location does NOT make browser cross-app auth work; the proxy is the robust path and is one env var away. |
| 4 | **Agent stays standalone** (studio calls it over HTTP). | One reasoning service, reusable. |

## 5. Call-path reality (important)

Same workspace ≠ same origin. Each Databricks App has its **own subdomain, own OAuth proxy, and a session cookie scoped to that hostname**. A browser `fetch` from the studio origin to the agent origin will **not** carry the agent's auth cookie → the platform proxy likely **401s the XHR** (login redirect a fetch can't follow), and CORS is a second wall. Co-location only helps **server-to-server** (studio SP token → agent).

**Therefore:**
- Client-side path requires **CORS middleware on the agent** (allow the studio origin, `allow_credentials=true`) + `fetch(..., {credentials:'include'})`.
- **M2 is an empirical spike**: does a studio-origin browser call return 200 from the agent? If not, flip to the **`server.mjs` proxy** (mints the studio app SP token via client-credentials against `{host}/oidc/v1/token`, forwards server-side — no CORS, no new deps).
- The agent base URL is configurable (build-time constant in `index.html` or a small `GET /config` from `server.mjs`) so the flip is trivial.

---

## 6. Workstreams

### WS-A — Format bridge (studio, client-side JS in `index.html`) — **linchpin**

Flatten `boardSnapshot()` → semantic `{version:1, industry, components:[{id,name,category,capabilities,description}], edges:[{sourceId,targetId,kind}]}`:

| Studio location | `category` | `zone` |
|---|---|---|
| `bands[id=ingest]` items | `ingestion` | `ing` |
| platform band tiles | `platform` | `platform` |
| `rails.src` groups | `source` | `src` |
| `rails.cons` groups | `consumer` | `cons` |
| `top.secs` tiles | `usecase` | `top` |
| `cloud.extras`/`providers` | `cloud` | `cloud` |

- `capabilities` ← `caps`/`caps2`; `description` ← `long`/`s`; `edges` ← resolve `rel`/`feeds`/`comps` names → ids.
- **`_uid`**: on first flatten, write a deterministic `zone:slug(name)` `_uid` onto each tile in board state and persist it.
- **`card_library`**: dump the union of base `ARCH` tiles (full SKU catalog) for agent enrichment.
- **Apply-map (reverse)**: `{action, component, component_id, category}` → target array; `add`→`category`→zone→`addTile(...)`; `remove`/`modify`→locate by `_uid` (fallback name)→`splice`/field-update; net-new (`component_id:null`)→new tile from `component`+`category`+`description`+`setup_notes`.
- **Tests**: `tests/bridge.test.mjs` (round-trip: flatten→apply is stable; `_uid` persistence; net-new placement).

### WS-B — Input ingestion panel (studio, ROADMAP Phase 2)
PNG upload, discovery JSON, field-requirements paste; persisted with board state + JSON export.

### WS-C — Vision extraction (agent, ROADMAP Phase 3)
`POST /api/studio/extract`: multipart/base64 image → Claude vision via existing `create_llm()` → structured `{components:[{name,type,category,description}], connections:[{source,target,kind}], zones:[]}` (+ backfill guards). Studio shows an **editable extraction-review** panel before it becomes `current_state`.

### WS-D — Wiring + auth (studio + agent)
Agent CORS middleware; studio `fetch` with agent base URL constant; `server.mjs` proxy fallback route (SP token). M2 spike decides which is live.

### WS-E — Review + apply UI (studio, ROADMAP Phase 5c)
Suggestions grouped by action with `reason/priority/availability/waf_note/setup_notes`; accept/reject/edit; "accept all high"; apply → canvas. Optional diff coloring (Phase 4) from `diff_stats`: green=match / blue=add / grey=legacy.

### WS-F — Spec export (studio, ROADMAP Phase 1, optional)
`.md` handoff for the demo-creation team.

---

## 7. Milestones

| M | Deliverable | Gate |
|---|---|---|
| **M1** | WS-A bridge + apply-map + `_uid` + unit tests; client-side call to `/api/studio/suggest` with a **pasted** current-state | Full loop returns real suggestions on Banking ref + Federal Bank inputs |
| **M2** | Client-side reachability **spike**; agent CORS; else `server.mjs` proxy | Studio browser gets 200 from the agent |
| **M3** | Review + apply UI → accepted suggestions mutate the canvas | Canvas shows target arch; edits persist |
| **M4** | Ingestion panel + project persistence | 4 inputs entered in-app, survive reload/export |
| **M5** | `/api/studio/extract` vision + extraction-review UI | Current-state PNG → editable components |
| **M6** | Diff coloring + spec export + polish | E2E demo runs clean |

## 8. Config fixes folded in
- Bump `STUDIO_MAX_REF_COMPONENTS` (139-component Banking ref currently clipped to 80) or prioritize collections-relevant components.
- Correct the agent's stale `GENIE_*` host if the agent runs in `fevm-india-feos` (harmless to the studio path — direct-LLM only).

## 9. Reference demo — Federal Bank collections (India, RBI)

- **current_state** ← Federal Bank PNG: CBS/Finacle (Oracle Exadata) → Enterprise EDW (1,000+ SPs, batch bottleneck) → AML/CIMS/NBO (scored after money moves).
- **discovery** ← 8-tab pack: 6 use cases (Customer 360, NBO, real-time fraud, AML, CIMS reporting, KYC/doc-intel), 7 sources w/ grain+pattern, 200–215 TB first-wave, 690 GB/day in, 500 users/300 concurrent, open gaps.
- **field_requirements** ← Indian collections POV (79 KB, fits the 120 KB budget): FR-1…FR-8 (45 sub-reqs); RBI Recovery Agent Directions (eff. Jan 2027 — IIBF certs, 8AM–7PM window, 6-month call-recording retention), ECL/Ind AS 109 (Apr 2027), Co-Lending Directions (2025), IRAC, SARFAESI.
- **reference_architecture** ← studio Banking industry board.

## 10. Top risks
1. **Client-side cross-app auth/CORS** — M2 spike gates downstream; proxy fallback ready.
2. **`_uid` round-trip** — skip it and modify/remove become fragile (name-match only).
3. **Two sequential LLM calls** (extract + suggest) — keep each single-pass; show progress.
4. **Live verification** — no working `fevm-india-feos` creds in the build env; M2 + deploy + E2E must be run against the live workspace by an owner.
