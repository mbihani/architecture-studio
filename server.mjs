import http from "node:http";
import fs from "node:fs";
import path from "node:path";

const PORT = Number(process.env.PORT ?? 8080);
const DIST = path.resolve("dist");

/* --- Studio <-> Product Research Agent integration config (env-driven) --- */
const AGENT_BASE_URL = (process.env.AGENT_BASE_URL || "").replace(/\/+$/, "");
const USE_PROXY = (process.env.STUDIO_USE_PROXY || "true") === "true";
const DATABRICKS_HOST = (process.env.DATABRICKS_HOST || "").replace(/\/+$/, "");
const CLIENT_ID = process.env.DATABRICKS_CLIENT_ID || "";
const CLIENT_SECRET = process.env.DATABRICKS_CLIENT_SECRET || "";
// Which /api/* POST paths are proxied straight through to the agent.
const PROXY_PATHS = new Set(["/api/studio/suggest", "/api/studio/extract"]);

const MIME = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".mjs": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
};

/* --- in-memory service-principal token cache (client-credentials) --- */
let _tokenCache = { value: "", expiresAt: 0 };

async function getServicePrincipalToken() {
  const now = Date.now();
  if (_tokenCache.value && now < _tokenCache.expiresAt) return _tokenCache.value;
  if (!DATABRICKS_HOST || !CLIENT_ID || !CLIENT_SECRET) {
    throw new Error("missing DATABRICKS_HOST / DATABRICKS_CLIENT_ID / DATABRICKS_CLIENT_SECRET");
  }
  const basic = Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString("base64");
  const resp = await fetch(`${DATABRICKS_HOST}/oidc/v1/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${basic}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials&scope=all-apis",
  });
  const text = await resp.text();
  if (!resp.ok) throw new Error(`token endpoint ${resp.status}: ${text.slice(0, 300)}`);
  let json;
  try { json = JSON.parse(text); } catch (_e) { throw new Error("token endpoint returned non-JSON"); }
  const token = json.access_token;
  if (!token) throw new Error("token endpoint response had no access_token");
  const ttlSec = Number(json.expires_in) || 3600;
  // Refresh ~5 min before expiry.
  _tokenCache = { value: token, expiresAt: now + Math.max(60, ttlSec - 300) * 1000 };
  return token;
}

function sendJson(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    let size = 0;
    const MAX = 8 * 1024 * 1024; // 8 MB guard
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > MAX) { reject(new Error("request body too large")); req.destroy(); return; }
      data += chunk;
    });
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}

/* --- proxy an /api/studio/* POST to the agent, server-to-server (SP token) --- */
async function handleProxy(req, res, urlPath) {
  if (!AGENT_BASE_URL || !DATABRICKS_HOST || !CLIENT_ID || !CLIENT_SECRET) {
    sendJson(res, 503, {
      error: "studio-agent proxy not configured",
      detail: "Set AGENT_BASE_URL, DATABRICKS_HOST, DATABRICKS_CLIENT_ID and DATABRICKS_CLIENT_SECRET on the studio app to enable the server-side proxy fallback.",
    });
    return;
  }
  let body;
  try {
    body = await readBody(req);
  } catch (err) {
    sendJson(res, 400, { error: "could not read request body", detail: String(err && err.message || err) });
    return;
  }
  let token;
  try {
    token = await getServicePrincipalToken();
  } catch (err) {
    sendJson(res, 503, { error: "could not mint service-principal token", detail: String(err && err.message || err) });
    return;
  }
  try {
    const upstream = await fetch(`${AGENT_BASE_URL}${urlPath}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: body || "{}",
    });
    const text = await upstream.text();
    res.writeHead(upstream.status, {
      "Content-Type": upstream.headers.get("content-type") || "application/json",
    });
    res.end(text);
  } catch (err) {
    sendJson(res, 502, { error: "agent request failed", detail: String(err && err.message || err) });
  }
}

function serveStatic(req, res) {
  let url = req.url === "/" ? "/index.html" : req.url;
  // Strip any query string before resolving a file path.
  const qi = url.indexOf("?");
  if (qi >= 0) url = url.slice(0, qi);
  const filePath = path.join(DIST, url);

  // Prevent path traversal
  if (!filePath.startsWith(DIST)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      // SPA fallback: serve index.html for any non-file route
      fs.readFile(path.join(DIST, "index.html"), (e2, d2) => {
        if (e2) {
          res.writeHead(404);
          res.end("Not found");
        } else {
          res.writeHead(200, { "Content-Type": "text/html" });
          res.end(d2);
        }
      });
    } else {
      const ext = path.extname(filePath);
      res.writeHead(200, { "Content-Type": MIME[ext] || "application/octet-stream" });
      res.end(data);
    }
  });
}

http.createServer((req, res) => {
  const urlPath = (req.url || "/").split("?")[0];

  // Only intercept /api/*; everything else is static.
  if (urlPath.startsWith("/api/")) {
    if (urlPath === "/api/config" && req.method === "GET") {
      sendJson(res, 200, { agentBaseUrl: AGENT_BASE_URL, useProxy: USE_PROXY });
      return;
    }
    if (PROXY_PATHS.has(urlPath) && req.method === "POST") {
      handleProxy(req, res, urlPath).catch((err) => {
        sendJson(res, 500, { error: "proxy handler crashed", detail: String(err && err.message || err) });
      });
      return;
    }
    sendJson(res, 404, { error: "unknown api route", path: urlPath });
    return;
  }

  serveStatic(req, res);
}).listen(PORT, () => {
  console.log(`Architecture Studio serving on port ${PORT}`);
  console.log(`  agent proxy: ${AGENT_BASE_URL ? AGENT_BASE_URL : "(AGENT_BASE_URL unset)"}  useProxy=${USE_PROXY}`);
});
