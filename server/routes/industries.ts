// ---------------------------------------------------------------------------
// Industry routes — list and activate industry overlays.
//
//   GET  /api/industries              → Industry[]
//   POST /api/industries/:id/activate → { id, activated }
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
  const industry = activateIndustry(req.params.id);
  if (!industry) {
    res.status(404).json({ error: `Unknown industry: ${req.params.id}` });
    return;
  }
  // TODO: create/switch the Lucid page scoped to industry.componentIds.
  res.json({ id: industry.id, activated: true });
});
