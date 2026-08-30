// ---------------------------------------------------------------------------
// Architecture Studio backend — Express server entry point.
//
// Runs on port 3001. Serves the JSON API consumed by the React frontend
// (proxied via Vite in dev). All routes are mounted under /api.
// ---------------------------------------------------------------------------

import { readFileSync } from "node:fs";

import cors from "cors";
import express from "express";

import { authRouter } from "./routes/auth.ts";
import { documentsRouter } from "./routes/documents.ts";
import { embedRouter } from "./routes/embed.ts";
import { exportRouter } from "./routes/export.ts";
import { industriesRouter } from "./routes/industries.ts";

const PORT = Number(process.env.PORT ?? 3001);

/**
 * Best-effort .env loader so the backend works locally without an external
 * dotenv dependency. Reads server/.env if present; missing files are ignored.
 * (In production prefer a real env loader / platform secrets.)
 */
function loadEnv(): void {
  try {
    const content = readFileSync(
      new URL(".env", import.meta.url),
      "utf8",
    );
    for (const line of content.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq === -1) continue;
      const key = trimmed.slice(0, eq).trim();
      const value = trimmed
        .slice(eq + 1)
        .trim()
        .replace(/^["']|["']$/g, "");
      if (!(key in process.env)) process.env[key] = value;
    }
  } catch {
    // No .env file present — rely on the real environment.
  }
}

loadEnv();

const app = express();
app.use(cors());
app.use(express.json({ limit: "10mb" }));

// Mount every route group under /api.
app.use("/api", authRouter);
app.use("/api", embedRouter);
app.use("/api", documentsRouter);
app.use("/api", industriesRouter);
app.use("/api", exportRouter);

// Health check.
app.get("/api/health", (_req, res) => {
  res.json({ ok: true, port: PORT });
});

app.listen(PORT, () => {
  console.log(`Architecture Studio backend listening on http://localhost:${PORT}`);
});
