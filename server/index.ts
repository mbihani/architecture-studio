// ---------------------------------------------------------------------------
// Architecture Studio backend — Express server entry point.
//
// Runs on port 3001 by default — matching the Vite dev proxy (vite.config.ts)
// so /api is same-origin in dev and no CORS is needed. Overridable via the PORT
// env var, which the Databricks App platform sets in production. Serves the
// JSON API consumed by the React frontend and, in production, the built
// frontend from dist/. API routes live under /api.
// ---------------------------------------------------------------------------

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import express from "express";

import { architectureRouter } from "./routes/architecture.ts";
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
// No CORS middleware: in production this server serves the built frontend
// from the same origin, and in dev Vite proxies /api to this same origin — so
// the browser never makes a cross-origin request to the API.
app.use(express.json({ limit: "10mb" }));

// Mount every route group under /api.
app.use("/api", architectureRouter);
app.use("/api", industriesRouter);

// Health check.
app.get("/api/health", (_req, res) => {
  res.json({ ok: true, port: PORT });
});

// --- Production static serving ---------------------------------------------
// After `vite build` emits dist/, serve the built React frontend from this
// same Express server so the app ships as a single origin. In dev dist/ is
// absent — Vite serves the frontend and proxies /api here — so this block
// stays inert and the dev workflow is unchanged.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distPath = path.resolve(__dirname, "..", "dist");

if (existsSync(distPath)) {
  app.use(express.static(distPath));
  // SPA fallback: any non-/api GET returns index.html so client-side routes
  // (e.g. /documents/<id>) resolve without a server round-trip.
  app.get("*", (req, res, next) => {
    if (req.path.startsWith("/api/")) return next();
    res.sendFile(path.join(distPath, "index.html"));
  });
}

app.listen(PORT, () => {
  console.log(`Architecture Studio backend listening on http://localhost:${PORT}`);
});
