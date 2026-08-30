// ---------------------------------------------------------------------------
// Architecture routes — serve and persist the draw.io mxfile XML.
//
//   GET  /api/architecture  → { drawioXml }
//   POST /api/architecture  ← { drawioXml } → { saved: boolean }
// ---------------------------------------------------------------------------

import { Router } from "express";

import {
  getArchitectureXml,
  saveArchitectureXml,
} from "../services/architecture-store.ts";

export const architectureRouter = Router();

architectureRouter.get("/architecture", (_req, res) => {
  res.json({ drawioXml: getArchitectureXml() });
});

architectureRouter.post("/architecture", (req, res) => {
  const body = req.body ?? {};
  if (typeof body.drawioXml !== "string" || body.drawioXml.length === 0) {
    res.status(400).json({ error: "Body must include a non-empty drawioXml string" });
    return;
  }
  saveArchitectureXml(body.drawioXml);
  res.json({ saved: true });
});
