# React Flow Architecture Viewer (POC)

Minimal, self-contained Vite + React + TypeScript app that renders Databricks
platform architecture components as an interactive React Flow (`@xyflow/react`
v12) diagram. Proves the approach works **same-origin, with no external runtime
dependency** — the build emits a static `dist/` bundle.

## Data

`src/data.ts` is generated from the architecture-studio converter output
(`converter/sample-output/architecture.json`): the first 15 platform components
(those whose `provenance` includes `"arch"`) and the edges among them.

## Run

```bash
# this Mac blocks npmjs.org — use the mirror
npm install --registry=https://registry.npmmirror.com
npm run dev      # http://localhost:5173
npm run build    # -> dist/
```

## Features

- Custom card nodes with a category-colored left border
- dagre auto-layout (left-to-right)
- Smoothstep edges with arrowheads, colored by edge kind
- Pan / zoom, node drag, click-to-select, Delete to remove
- Sidebar "Add Component" button (adds a node at viewport center)
- Category + edge legend; minimap colored by category
