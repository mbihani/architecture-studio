// ---------------------------------------------------------------------------
// Industry routes — list and activate industry diagram pages.
//
//   GET  /api/industries              → Industry[]
//   POST /api/industries/:id/activate → { id, activated, drawioXml }
//
// Industries are parsed from the mxfile's <diagram> elements; activating an
// industry returns its single-page mxfile XML so the frontend can load it
// into the draw.io embed iframe.
// ---------------------------------------------------------------------------

import { Router } from "express";

import {
  getIndustries,
  getIndustryXml,
} from "../services/architecture-store.ts";

export const industriesRouter = Router();

industriesRouter.get("/industries", (_req, res) => {
  res.json(getIndustries());
});

industriesRouter.post("/industries/:id/activate", (req, res) => {
  const id = req.params.id;
  const industries = getIndustries();
  const industry = industries.find((ind) => ind.id === id);
  if (!industry) {
    res.status(404).json({ error: `Unknown industry: ${id}` });
    return;
  }
  const drawioXml = getIndustryXml(id);
  if (!drawioXml) {
    res.status(404).json({ error: `Industry page not found: ${id}` });
    return;
  }
  res.json({ id: industry.id, activated: true, drawioXml });
});
