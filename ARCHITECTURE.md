# Architecture Studio — Technical Design

## System Overview

Architecture Studio embeds an editable Lucidchart canvas (via Lucid's token-based Embed API, `mode=editor`) inside a React web app. Users edit architecture diagrams in Lucid's native UI. A backend handles OAuth, document lifecycle, and readback sync. A data converter imports Amr Alieg's reference architecture data as the starting point.

## Key Design Decisions

1. **Lucidchart IS the canvas** — we do not build a custom canvas (no React Flow). All visual editing (drag, connect, add/remove shapes) happens in Lucid's native editor via iframe embed.
2. **Token-based embed** — our backend holds OAuth tokens and generates short-lived embed session tokens, avoiding third-party cookie issues.
3. **Readback via polling** — Lucid has no change webhook. We poll `GET /documents/{id}/contents` to mirror the doc into our ArchitectureDoc JSON format.
4. **Standard Import JSON** — Lucid's documented format for programmatically creating documents with shapes, lines, groups, and pages. This is how we seed the initial architecture.

## Data Model

### ArchitectureDoc JSON (our semantic format)

The normalized, serializable representation of an architecture. This is what we export and what the readback sync produces.

```jsonc
{
  "version": 1,
  "components": [
    {
      "id": "550e8400-e29b-41d4-a716-446655440000",  // stable UUID
      "name": "Unity Catalog",
      "shortName": "UC",
      "category": "platform",           // platform | source | ingestion | consumer | usecase | cloud
      "icon": "uc",                      // icon key from Amr's SVG dictionary
      "zone": "platform",               // platform | src | ing | ppl | cons | top | cloud
      "description": "Unified governance...",
      "capabilities": ["lineage", "access control"],
      "relatedIds": ["uuid-of-related-component"],
      "dataOut": {
        "batch": { "types": ["structured"], "vol": "high", "interval": "hourly" },
        "stream": { "types": ["semi-structured"], "vol": "med", "interval": "realtime" }
      },
      "cite": ["ref-key"],
      "what": "What this does",
      "users": "Who uses it",
      "kpis": ["kpi1"],
      "teams": ["team1"]
    }
  ],
  "edges": [
    {
      "id": "uuid",
      "sourceId": "component-uuid",
      "targetId": "component-uuid",
      "kind": "flow"         // flow | related | feeds | uses
    }
  ],
  "industries": [
    {
      "id": "banking",
      "label": "Banking",
      "blurb": "...",
      "componentIds": ["uuid", "uuid"],
      "medallion": {
        "Bronze": { "s": "...", "long": "..." },
        "Silver": { "s": "...", "long": "..." },
        "Gold":   { "s": "...", "long": "..." }
      }
    }
  ]
}
```

### Lucid Standard Import JSON (Lucid's format)

Reference: https://developer.lucid.co/docs/overview-si

Packaged as a `.lucid` archive (ZIP) containing `document.json`. Key structure
(field names match the official SI spec — `boundingBox` + `style` for shapes,
`endpoint1`/`endpoint2` for lines, `groups` array on each page):

```jsonc
{
  "version": 1,
  "pages": [
    {
      "id": "page-1",
      "title": "Platform",
      "shapes": [
        {
          "id": "shape-1",
          "type": "rectangle",
          "boundingBox": { "x": 100, "y": 100, "w": 200, "h": 80 },
          "text": "Unity Catalog",
          "style": {
            "fill":   { "type": "color", "color": "#FF6B35" },
            "stroke": { "color": "#333333", "width": 1, "style": "solid" }
          }
        }
      ],
      "lines": [
        {
          "id": "line-1",
          "lineType": "elbow",
          "endpoint1": { "type": "shapeEndpoint", "style": "none",  "shapeId": "shape-1" },
          "endpoint2": { "type": "shapeEndpoint", "style": "arrow", "shapeId": "shape-2" },
          "stroke": { "color": "#9CA3AF", "width": 1, "style": "solid" }
        }
      ],
      "groups": []
    }
  ]
}
```

## API Contract (Frontend ↔ Backend)

### Auth
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/auth/lucid` | Redirect to Lucid OAuth authorization page |
| GET | `/api/auth/lucid/callback` | OAuth callback — exchange code for tokens, store server-side |
| GET | `/api/auth/status` | Check if authenticated |

### Embed
| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/embed/session` | Generate short-lived embed session token for a document |
| Response: `{ token, url }` | | |

### Documents
| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/documents/create` | Create Lucid doc from Standard Import JSON. Body: `{ importJson, name }` |
| GET | `/api/documents` | List user's Lucid documents |
| GET | `/api/documents/:id/contents` | Read back document contents (polled by frontend) |
| GET | `/api/documents/:id/export` | Export document as PNG/PDF |

### Industries
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/industries` | List available industries (from ArchitectureDoc) |
| POST | `/api/industries/:id/activate` | Switch to industry — may create/switch Lucid page |

### Export
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/export/:id` | Read back doc, convert to ArchitectureDoc JSON, return as download |

## File Structure

```
architecture-studio/
├── src/                    # Frontend (React + Vite)
│   ├── components/         # React components (EmbedFrame, IndustrySwitcher, ExportButton, Header)
│   ├── hooks/              # useLucidEmbed, useDocumentSync, useIndustries
│   ├── api/                # API client functions
│   ├── types/              # TypeScript types (ArchitectureDoc, LucidImport, API)
│   └── App.tsx
├── server/                 # Backend (Express + TypeScript)
│   ├── routes/             # auth, embed, documents, industries, export
│   ├── services/           # lucid-oauth, lucid-api, converter
│   └── index.ts
├── converter/              # Data converter (Amr's data → Lucid Standard Import JSON)
│   ├── parse-arch.*        # Parse ARCH from HTML
│   ├── parse-industries.*  # Parse INDUSTRIES from Python/HTML
│   ├── normalize.*         # Assign UUIDs, build edge table
│   ├── map-to-lucid.*      # Map to Lucid Standard Import JSON
│   └── index.*            # CLI entry point
├── ARCHITECTURE.md         # This file
└── package.json
```

## FEVM Deployment

Target workspace: `stable-classic-7ppxjq` (AWS us-east-1, Resource ID: 9d74930b-68ad-4870-95cc-c716e35992d3). Deploy as a Databricks App.

## Source Data

Amr's repo: https://github.com/amralieg/interactive-databricks-enterprise-architecture
- `ARCH` (Databricks platform): hand-authored in `app/index.html` at ~line 2666
- `INDUSTRIES` (63 industry overlays): source of truth in `tools/industries/batch_*.py`, schema in `tools/industries/common.py`
- Connections: name-based (`rel`, `from`, `feeds`, `comps`) — no explicit edges, no stable IDs
- Rendering: custom DOM + CSS grid (no graph library) — replaced by Lucidchart's native editor
