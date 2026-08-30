// ---------------------------------------------------------------------------
// Embed route — generate a short-lived Lucid embed session.
//
//   POST /api/embed/session  { documentId } → { token, url }
// ---------------------------------------------------------------------------

import { Router } from "express";

import { generateEmbedSession } from "../services/lucid-api.ts";
import { getSessionId } from "../services/session.ts";

export const embedRouter = Router();

embedRouter.post("/embed/session", async (req, res) => {
  const documentId =
    typeof req.body?.documentId === "string" ? req.body.documentId : "";

  if (!documentId) {
    res.status(400).json({ error: "Missing documentId in request body" });
    return;
  }

  try {
    const session = await generateEmbedSession(getSessionId(req), documentId);
    res.json(session);
  } catch (err) {
    res
      .status(502)
      .json({ error: `Failed to generate embed session: ${(err as Error).message}` });
  }
});
