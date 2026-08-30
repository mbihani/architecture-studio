# architecture-studio-poc-rf

A standalone single-page React + Vite + TypeScript app that renders the
Databricks architecture (139 components, 153 edges) as an interactive,
editable node/edge graph using **[@xyflow/react](https://reactflow.dev)**
(React Flow v12) and **dagre** for initial auto-layout.

This is a POC that replaces the previous draw.io embed: **no iframe, no
external runtime dependency, no embed.diagrams.net** — everything is bundled
JS served same-origin from `dist/`.

## Data

`public/architecture.json` — components (`id`, `name`, `category`, `zone`,
`description`, `icon`) and edges (`id`, `sourceId`, `targetId`, `kind`). Loaded
at runtime via a same-origin fetch.

## Features

- Custom React Flow nodes: cards coloured by category
  (source=blue, ingestion=purple, platform=green, consumer=orange, cloud=gray,
  usecase=red), showing the icon badge, name, and a category·icon caption.
- Edges with arrows, coloured by kind (flow=blue, feeds=green, related=gray,
  uses=orange).
- Dagre-driven initial layout grouped by zone: `src` left → `ing` → `platform`
  (centre) → `cons` → `ppl`, with `top` lifted above platform and `cloud` laid
  across the bottom.
- Pan, zoom, node dragging, and edge/node selection.
- Sidebar: category dropdown + name search to filter nodes (edges hide
  automatically when their endpoints are filtered out).
- **Add Component** — drops a new blank node at the viewport centre.
- **Delete Selected** — removes selected nodes/edges (and edges attached to
  deleted nodes).
- **Export PNG** — renders the fitted graph to a PNG download
  (`html-to-image`).

## Scripts

```sh
npm install            # uses the npmmirror registry via .npmrc
npm run dev            # vite dev server
npm run build          # vite build -> dist/
npm run preview        # serve the built dist/
```

> This Mac blocks npmjs.org; `.npmrc` pins the registry to
> `https://registry.npmmirror.com` so all installs work locally.
