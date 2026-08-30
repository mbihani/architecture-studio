# Architecture Studio

An editable visual interface for Databricks enterprise reference architectures. Built on top of [Amr Alieg's interactive architecture viewer](https://github.com/amralieg/interactive-databricks-enterprise-architecture), this app embeds an **editable Lucidchart canvas** (via Lucid's Embed API) so users can add, remove, update, and reposition architectural components in a native diagramming UI.

## Architecture

- **Frontend**: React + TypeScript + Vite — app shell surrounding a Lucidchart embed iframe
- **Backend**: Express + TypeScript — OAuth token management, Lucid document lifecycle, readback sync
- **Data converter**: Python/TS pipeline — converts Amr's `ARCH` + `INDUSTRIES` data into Lucid Standard Import JSON
- **Lucid integration**: Token-based Embed API (`mode=editor`) for the editable canvas

## Getting started

```bash
npm install
npm run dev
```

Frontend runs on `localhost:5173`, backend on `localhost:3001`.

## Data flow

```
Amr's batch_*.py + ARCH (HTML)
    → Data converter → Lucid Standard Import JSON
    → POST to Lucid create-document API
    → Editable Lucidchart iframe (user edits here)
    → Poll GET /documents/{id}/contents
    → ArchitectureDoc JSON (our semantic format)
    → Export
```

## License

MIT
