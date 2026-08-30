// ---------------------------------------------------------------------------
// Export route — read back a Lucid doc and return it as ArchitectureDoc JSON.
//
//   GET /api/export/:id → ArchitectureDoc JSON file download
//
// The real implementation reads back the document contents (via the Lucid API
// service) and converts them into our ArchitectureDoc format. Until the
// converter is wired in, this returns the mock architecture document as a
// downloadable JSON file. See TODOs.
// ---------------------------------------------------------------------------

import { Router } from "express";

import { mockArchitectureDoc } from "../services/architecture-store.ts";

export const exportRouter = Router();

exportRouter.get("/export/:id", (req, res) => {
  const id = req.params.id;

  // TODO: const contents = await getDocumentContents(id);
  //       const doc = convertLucidToArchitectureDoc(contents);
  // For now we return the mock architecture document.
  const doc = mockArchitectureDoc;

  res.setHeader("Content-Type", "application/json");
  res.setHeader(
    "Content-Disposition",
    `attachment; filename="architecture-${id}.json"`,
  );
  res.json(doc);
});
