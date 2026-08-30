// ---------------------------------------------------------------------------
// Export route — read back a Lucid doc and return it as ArchitectureDoc JSON.
//
//   GET /api/export/:id → ArchitectureDoc JSON file download
//
// The real implementation reads back the document contents (via the Lucid API
// service) and converts them into our ArchitectureDoc format. That conversion
// is owned by the converter/ package (another worker) and is not wired in
// here, so this endpoint returns 501 until the converter is available. The
// frontend's ExportButton uses the real binary export at
// GET /api/documents/:id/export (PNG/PDF) instead of this route.
// ---------------------------------------------------------------------------

import { Router } from "express";

export const exportRouter = Router();

exportRouter.get("/export/:id", (_req, res) => {
  res.status(501).json({
    error:
      "ArchitectureDoc JSON export requires the data converter, which is not yet wired in. " +
      "Use GET /api/documents/:id/export for the binary (PNG/PDF) export.",
  });
});
