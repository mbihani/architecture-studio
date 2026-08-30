// ---------------------------------------------------------------------------
// Industry routes — list and activate industry diagram pages.
//
//   GET  /api/industries              → Industry[]
//   POST /api/industries/:id/activate → { id, activated }
//
// Industries are parsed from the mxfile's <diagram> elements. Activating an
// industry records it as the active page (backend bookkeeping); the frontend
// switches the editor tab client-side (see useDrawioEmbed.switchPage), so the
// full mxfile — and therefore every page — is always preserved on save.
// ---------------------------------------------------------------------------

import { Router } from "express";

import {
  activateIndustry,
  getIndustries,
} from "../services/architecture-store.ts";

export const industriesRouter = Router();

industriesRouter.get("/industries", (_req, res) => {
  res.json(getIndustries());
});

industriesRouter.post("/industries/:id/activate", (req, res) => {
  const id = req.params.id;
  const industry = getIndustries().find((ind) => ind.id === id);
  if (!industry) {
    res.status(404).json({ error: `Unknown industry: ${id}` });
    return;
  }
  activateIndustry(id);
  res.json({ id: industry.id, activated: true });
});
