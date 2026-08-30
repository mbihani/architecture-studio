// ---------------------------------------------------------------------------
// Document routes — Lucid document lifecycle.
//
//   POST /api/documents/create        { importJson, name } → { id, name }
//   GET  /api/documents                                   → DocumentListItem[]
//   GET  /api/documents/:id/contents                       → read-back contents
//   GET  /api/documents/:id/export?format=png|pdf          → binary download
// ---------------------------------------------------------------------------

import { Router } from "express";

import {
  createDocumentFromImport,
  exportDocument,
  getDocumentContents,
  listDocuments,
} from "../services/lucid-api.ts";
import { getSessionId } from "../services/session.ts";
import type { LucidImportJson } from "../types.ts";

export const documentsRouter = Router();

documentsRouter.post("/documents/create", async (req, res) => {
  const body = req.body ?? {};
  const importJson = body.importJson as LucidImportJson | undefined;
  const name = typeof body.name === "string" ? body.name : "";

  if (!importJson || !Array.isArray(importJson.pages)) {
    res
      .status(400)
      .json({ error: "Body must include importJson with a pages array" });
    return;
  }
  if (!name) {
    res.status(400).json({ error: "Body must include a document name" });
    return;
  }

  try {
    const doc = await createDocumentFromImport(getSessionId(req), importJson, name);
    res.json(doc);
  } catch (err) {
    res
      .status(502)
      .json({ error: `Failed to create document: ${(err as Error).message}` });
  }
});

documentsRouter.get("/documents", async (req, res) => {
  try {
    const docs = await listDocuments(getSessionId(req));
    res.json(docs);
  } catch (err) {
    res
      .status(502)
      .json({ error: `Failed to list documents: ${(err as Error).message}` });
  }
});

documentsRouter.get("/documents/:id/contents", async (req, res) => {
  const id = req.params.id;
  try {
    const contents = await getDocumentContents(getSessionId(req), id);
    res.json(contents);
  } catch (err) {
    res
      .status(502)
      .json({ error: `Failed to read document contents: ${(err as Error).message}` });
  }
});

documentsRouter.get("/documents/:id/export", async (req, res) => {
  const id = req.params.id;
  const format = req.query.format === "pdf" ? "pdf" : "png";
  try {
    const { buffer, contentType } = await exportDocument(getSessionId(req), id, format);
    res.setHeader("Content-Type", contentType);
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${id}.${format}"`,
    );
    res.send(buffer);
  } catch (err) {
    res
      .status(502)
      .json({ error: `Failed to export document: ${(err as Error).message}` });
  }
});
