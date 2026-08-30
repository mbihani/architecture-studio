// ---------------------------------------------------------------------------
// Wrapper for the Lucid REST API (https://api.lucid.co).
//
// Every function makes a real `fetch` call against Lucid's documented
// endpoints. When LUCID_CLIENT_ID / LUCID_CLIENT_SECRET are not configured
// (mock mode) the functions return clearly-marked MOCK responses so the app
// shell is fully exercisable end-to-end without real credentials.
//
// API references (Lucid developer docs):
//   - REST API overview:        https://lucid.readme.io/reference/overview
//   - Required headers:         https://lucid.readme.io/reference/headers
//   - Standard Import:          https://lucid.readme.io/docs/overview-si
//   - Create from SI file:      https://lucid.readme.io/reference/createdocumentwithstandardimport
//   - Search documents (list):  https://lucid.readme.io/reference/searchdocuments
//   - Document contents:        https://lucid.readme.io/reference/getdocumentcontent
//   - Get/Export document:      https://lucid.readme.io/reference/getorexportdocument
//   - Export async:              https://lucid.readme.io/reference/exportdocumentlongrunning
//   - Export job status:         https://lucid.readme.io/reference/exportdocumentlongrunningstatus
//   - Embed session token:       https://lucid.readme.io/reference/documentembedstoken
//   - OAuth access scopes:       https://lucid.readme.io/reference/access-scopes
//
// Lucid requires an Authorization header and a Lucid-Api-Version header on
// every call. All endpoints here are versioned in the path (/v1/...); the
// Lucid-Api-Version header is also sent explicitly (value "1") per the
// headers reference, which notes either the path version or the header
// satisfies the requirement.
//
// NOTE: Lucid may require a paid plan for programmatic document creation and
// the embed-session endpoint. The real call is still made and any error is
// surfaced to the caller.
// ---------------------------------------------------------------------------

import { getValidAccessToken, isMockMode } from "./lucid-oauth.ts";
import type { LucidImportJson, LucidPage, LucidShape, LucidLine, LucidGroup } from "../types.ts";

const LUCID_API_BASE = "https://api.lucid.co";
const LUCID_EMBED_BASE = "https://lucid.app/embeds";
const LUCID_API_VERSION = "1";
/** Standard Import product we create/export as (architecture diagrams). */
const LUCID_PRODUCT = "lucidchart";
/** MIME that marks a .lucid Standard Import archive (per overview-si docs). */
const STANDARD_IMPORT_MIME = "x-application/vnd.lucid.standardImport";

export interface LucidDocumentRef {
  id: string;
  name: string;
}

/** Build the headers required on every Lucid REST call. */
function apiHeaders(token: string, extra?: Record<string, string>): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    "Lucid-Api-Version": LUCID_API_VERSION,
    ...(extra ?? {}),
  };
}

/** Fetch helper: ensure a usable access token or throw. */
async function requireToken(sessionId: string | undefined): Promise<string> {
  const token = await getValidAccessToken(sessionId);
  if (!token) {
    throw new Error("Not authenticated with Lucid (session expired or missing)");
  }
  return token;
}

/** Read an error response body safely, falling back to statusText. */
async function safeErrorText(res: Response): Promise<string> {
  try {
    return await res.text();
  } catch {
    return res.statusText;
  }
}

// --- ZIP archive builder (stored, no compression) --------------------------

const CRC_TABLE: Uint32Array = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

/**
 * Build a minimal stored-method (no compression) ZIP archive containing a
 * single entry. Lucid's Standard Import expects a .lucid archive (ZIP) whose
 * only file is `document.json`.
 */
function buildStoredZip(filename: string, content: Buffer): Buffer {
  const nameBuf = Buffer.from(filename, "utf8");
  const crc = crc32(content);
  const size = content.length;

  // Local file header (30 bytes) + filename + content.
  const localHeader = Buffer.alloc(30);
  localHeader.writeUInt32LE(0x04034b50, 0); // signature
  localHeader.writeUInt16LE(20, 4); // version needed
  localHeader.writeUInt16LE(0, 6); // flags
  localHeader.writeUInt16LE(0, 8); // compression (stored)
  localHeader.writeUInt16LE(0, 10); // mod time
  localHeader.writeUInt16LE(0x21, 12); // mod date
  localHeader.writeUInt32LE(crc, 14); // crc32
  localHeader.writeUInt32LE(size, 18); // compressed size
  localHeader.writeUInt32LE(size, 22); // uncompressed size
  localHeader.writeUInt16LE(nameBuf.length, 26); // filename length
  localHeader.writeUInt16LE(0, 28); // extra length
  const localBlob = Buffer.concat([localHeader, nameBuf, content]);

  // Central directory record (46 bytes) + filename.
  const centralHeader = Buffer.alloc(46);
  centralHeader.writeUInt32LE(0x02014b50, 0); // signature
  centralHeader.writeUInt16LE(20, 4); // version made by
  centralHeader.writeUInt16LE(20, 6); // version needed
  centralHeader.writeUInt16LE(0, 8); // flags
  centralHeader.writeUInt16LE(0, 10); // compression
  centralHeader.writeUInt16LE(0, 12); // mod time
  centralHeader.writeUInt16LE(0x21, 14); // mod date
  centralHeader.writeUInt32LE(crc, 16); // crc32
  centralHeader.writeUInt32LE(size, 20); // compressed size
  centralHeader.writeUInt32LE(size, 24); // uncompressed size
  centralHeader.writeUInt16LE(nameBuf.length, 28); // filename length
  centralHeader.writeUInt16LE(0, 30); // extra length
  centralHeader.writeUInt16LE(0, 32); // comment length
  centralHeader.writeUInt16LE(0, 34); // disk number
  centralHeader.writeUInt16LE(0, 36); // internal attrs
  centralHeader.writeUInt32LE(0, 38); // external attrs
  centralHeader.writeUInt32LE(0, 42); // local header offset
  const centralBlob = Buffer.concat([centralHeader, nameBuf]);

  // End of central directory (22 bytes).
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0); // signature
  eocd.writeUInt16LE(0, 4); // disk number
  eocd.writeUInt16LE(0, 6); // disk with CD
  eocd.writeUInt16LE(1, 8); // entries on disk
  eocd.writeUInt16LE(1, 10); // total entries
  eocd.writeUInt32LE(centralBlob.length, 12); // CD size
  eocd.writeUInt32LE(localBlob.length, 16); // CD offset
  eocd.writeUInt16LE(0, 20); // comment length

  return Buffer.concat([localBlob, centralBlob, eocd]);
}

// --- multipart/form-data builder (no DOM FormData dependency) --------------

interface MultipartField {
  name: string;
  /** String value (sent as text) or Buffer (sent as a file part). */
  value: string | Buffer;
  /** Filename for Buffer parts. */
  filename?: string;
  /** Content-Type for Buffer parts. */
  contentType?: string;
}

/**
 * Build a multipart/form-data body manually. This avoids relying on the DOM
 * `FormData`/`Blob` globals (the backend TS lib is ES2022, not DOM) while
 * producing a spec-compliant multipart body for the create-document endpoint.
 */
function buildMultipartFormData(fields: MultipartField[]): {
  body: Buffer;
  contentType: string;
} {
  const boundary = `----LucidStandardImport${crypto.randomUUID().replace(/-/g, "")}`;
  const parts: Buffer[] = [];
  const CRLF = "\r\n";

  for (const f of fields) {
    parts.push(Buffer.from(`--${boundary}${CRLF}`));
    if (f.filename) {
      const ct = f.contentType ?? "application/octet-stream";
      parts.push(
        Buffer.from(
          `Content-Disposition: form-data; name="${f.name}"; filename="${f.filename}"${CRLF}` +
            `Content-Type: ${ct}${CRLF}${CRLF}`,
        ),
      );
    } else {
      parts.push(
        Buffer.from(`Content-Disposition: form-data; name="${f.name}"${CRLF}${CRLF}`),
      );
    }
    parts.push(Buffer.isBuffer(f.value) ? f.value : Buffer.from(f.value, "utf8"));
    parts.push(Buffer.from(CRLF));
  }
  parts.push(Buffer.from(`--${boundary}--${CRLF}`));

  return {
    body: Buffer.concat(parts),
    contentType: `multipart/form-data; boundary=${boundary}`,
  };
}

// --- Lucid response shapes -------------------------------------------------

/** Document resource returned by create/search/get (subset of fields). */
interface LucidDocumentResource {
  documentId?: string;
  title?: string;
}

/** Shape/line/group item in a contents read-back page. */
interface LucidContentsShape {
  id?: string;
  class?: string;
}
interface LucidContentsLine {
  id?: string;
  endpoint1?: { id?: string };
  endpoint2?: { id?: string };
}
interface LucidContentsGroup {
  id?: string;
  members?: string[];
}
interface LucidContentsPage {
  id?: string;
  title?: string;
  index?: number;
  items?: {
    shapes?: LucidContentsShape[];
    lines?: LucidContentsLine[];
    groups?: LucidContentsGroup[];
  };
}
interface LucidContentsResponse {
  id?: string;
  title?: string;
  pages?: LucidContentsPage[];
}

/** Async export job creation/status responses. */
interface LucidExportJobResponse {
  jobId?: string;
}
interface LucidExportJobStatus {
  status?: string;
  response?: { downloadUrl?: string };
}

// --- Document lifecycle ----------------------------------------------------

/**
 * Create a Lucid document from Standard Import JSON.
 *
 * The import JSON is packaged as a .lucid archive (ZIP of document.json) and
 * uploaded as multipart/form-data to the documented create endpoint:
 *   POST /v1/documents/create
 * with form fields `file` (the .lucid zip), `type` (the Standard Import MIME),
 * `product` ("lucidchart"), and `title`. Returns the new document id+title.
 *
 * Requires the `lucidchart.document.content` or `lucidchart.document.app.folder`
 * OAuth scope (see server/routes/auth.ts).
 *
 * Ref: https://lucid.readme.io/reference/createdocumentwithstandardimport
 */
export async function createDocumentFromImport(
  sessionId: string | undefined,
  importJson: LucidImportJson,
  name: string,
): Promise<LucidDocumentRef> {
  if (isMockMode()) {
    // MOCK: synthesize a stable-looking document id.
    return {
      id: `doc-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
      name,
    };
  }

  const token = await requireToken(sessionId);
  const documentJson = Buffer.from(JSON.stringify(importJson), "utf8");
  const archive = buildStoredZip("document.json", documentJson);

  const { body, contentType } = buildMultipartFormData([
    {
      name: "file",
      value: archive,
      filename: "document.lucid",
      contentType: STANDARD_IMPORT_MIME,
    },
    { name: "type", value: STANDARD_IMPORT_MIME },
    { name: "product", value: LUCID_PRODUCT },
    { name: "title", value: name },
  ]);

  const res = await fetch(`${LUCID_API_BASE}/v1/documents/create`, {
    method: "POST",
    headers: apiHeaders(token, { "Content-Type": contentType }),
    body,
  });
  if (!res.ok) {
    const detail = await safeErrorText(res);
    throw new Error(`Lucid create document failed (${res.status}): ${detail}`);
  }
  const doc = (await res.json()) as LucidDocumentResource;
  return { id: doc.documentId ?? "", name: doc.title ?? name };
}

/**
 * List the user's Lucid documents.
 *
 * Lucid has no `GET /documents` list endpoint; listing is done via the
 * document search endpoint, which returns the user's documents when called
 * with an (all-optional) empty filter body:
 *   POST /v1/documents/search  body: {}
 *
 * Ref: https://lucid.readme.io/reference/searchdocuments
 */
export async function listDocuments(
  sessionId: string | undefined,
): Promise<LucidDocumentRef[]> {
  if (isMockMode()) {
    // MOCK: a single demo document so the app shell has something to embed.
    return [{ id: "doc-demo", name: "Architecture Studio (demo)" }];
  }

  const token = await requireToken(sessionId);
  const res = await fetch(`${LUCID_API_BASE}/v1/documents/search`, {
    method: "POST",
    headers: apiHeaders(token, {
      "Content-Type": "application/json",
      Accept: "application/json",
    }),
    body: JSON.stringify({}),
  });
  if (!res.ok) {
    const detail = await safeErrorText(res);
    throw new Error(`Lucid list documents failed (${res.status}): ${detail}`);
  }
  const data = (await res.json()) as
    | LucidDocumentResource[]
    | { documents?: LucidDocumentResource[] };
  const items = Array.isArray(data) ? data : (data.documents ?? []);
  return items.map((d) => ({
    id: d.documentId ?? "",
    name: d.title ?? "Untitled",
  }));
}

/**
 * Read back a document's contents (pages/shapes/lines/groups).
 *
 *   GET /v1/documents/{id}/contents
 *
 * Lucid's read-back page shape (`{ id, title, index, items: { shapes, lines,
 * groups } }`) differs from our Standard Import `LucidPage` shape. We map it
 * structurally here so the read-back poll type-checks; the authoritative
 * Lucid→ArchitectureDoc conversion lives in the converter (out of scope here).
 *
 * Ref: https://lucid.readme.io/reference/getdocumentcontent
 *      https://lucid.readme.io/reference/document-contents-resource
 */
export async function getDocumentContents(
  sessionId: string | undefined,
  id: string,
): Promise<{ id: string; pages: LucidPage[]; updatedAt?: number }> {
  if (isMockMode()) {
    // MOCK: an empty page so the readback poll succeeds.
    return {
      id,
      pages: [
        { id: "page-1", name: "Platform", shapes: [], lines: [], groups: [] },
      ],
      updatedAt: Date.now(),
    };
  }

  const token = await requireToken(sessionId);
  const res = await fetch(
    `${LUCID_API_BASE}/v1/documents/${encodeURIComponent(id)}/contents`,
    { headers: apiHeaders(token, { Accept: "application/json" }) },
  );
  if (!res.ok) {
    const detail = await safeErrorText(res);
    throw new Error(`Lucid readback failed (${res.status}): ${detail}`);
  }
  const data = (await res.json()) as LucidContentsResponse;
  const pages: LucidPage[] = (data.pages ?? []).map((p): LucidPage => ({
    id: p.id ?? "",
    name: p.title ?? "",
    shapes: (p.items?.shapes ?? []).map((s): LucidShape => ({
      id: s.id ?? "",
      // Lucid uses `class` for the shape type (e.g. "ProcessBlock").
      type: s.class ?? "shape",
      // The contents read-back does not expose x/y/width/height in the
      // documented schema; the converter derives layout where needed.
      x: 0,
      y: 0,
      width: 0,
      height: 0,
    })),
    lines: (p.items?.lines ?? []).map((l): LucidLine => ({
      id: l.id ?? "",
      sourceId: l.endpoint1?.id ?? "",
      destinationId: l.endpoint2?.id ?? "",
    })),
    groups: (p.items?.groups ?? []).map((g): LucidGroup => ({
      id: g.id ?? "",
      children: g.members ?? [],
    })),
  }));
  return { id, pages, updatedAt: Date.now() };
}

/**
 * Export a document as PNG or PDF via Lucid's asynchronous export endpoint.
 *
 *   POST /v1/documents/{id}/export/jobs   (Accept header selects the format)
 *   GET  /v1/documents/{id}/export/jobs/{jobId}  → { status, response.downloadUrl }
 *
 * The synchronous `GET /v1/documents/{id}` export only supports image/png and
 * image/jpeg; PDF requires the async flow, so the async endpoint is used for
 * both formats for a single code path. PNG → `image/png`, PDF →
 * `application/pdf`. When the job succeeds, `response.downloadUrl` is a
 * temporary (1-hour) URL that is fetched for the binary payload.
 *
 * Ref: https://lucid.readme.io/reference/exportdocumentlongrunning
 *      https://lucid.readme.io/reference/exportdocumentlongrunningstatus
 */
export async function exportDocument(
  sessionId: string | undefined,
  id: string,
  format: "png" | "pdf" = "png",
): Promise<{ buffer: Buffer; contentType: string }> {
  if (isMockMode()) {
    // MOCK: a placeholder payload so the export path is exercisable.
    return {
      buffer: Buffer.from(`mock ${format} export for ${id}`),
      contentType: format === "pdf" ? "application/pdf" : "image/png",
    };
  }

  const token = await requireToken(sessionId);
  const acceptMime = format === "pdf" ? "application/pdf" : "image/png";

  // 1. Start the export job (the Accept header selects the output format).
  const startRes = await fetch(
    `${LUCID_API_BASE}/v1/documents/${encodeURIComponent(id)}/export/jobs`,
    {
      method: "POST",
      headers: apiHeaders(token, { Accept: acceptMime }),
    },
  );
  if (!startRes.ok) {
    const detail = await safeErrorText(startRes);
    throw new Error(`Lucid export failed (${startRes.status}): ${detail}`);
  }
  const job = (await startRes.json()) as LucidExportJobResponse;
  const jobId = job.jobId;
  if (!jobId) {
    throw new Error("Lucid export did not return a jobId");
  }

  // 2. Poll the job status until it succeeds or fails (bounded).
  const MAX_ATTEMPTS = 60;
  const POLL_INTERVAL_MS = 1000;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
    const statusRes = await fetch(
      `${LUCID_API_BASE}/v1/documents/${encodeURIComponent(id)}/export/jobs/${encodeURIComponent(jobId)}`,
      { headers: apiHeaders(token) },
    );
    if (!statusRes.ok) {
      const detail = await safeErrorText(statusRes);
      throw new Error(`Lucid export status failed (${statusRes.status}): ${detail}`);
    }
    const status = (await statusRes.json()) as LucidExportJobStatus;
    if (status.status === "SUCCEEDED" && status.response?.downloadUrl) {
      // 3. Download the rendered payload from the temporary URL.
      const dl = await fetch(status.response.downloadUrl);
      if (!dl.ok) {
        throw new Error(`Lucid export download failed (${dl.status})`);
      }
      return {
        buffer: Buffer.from(await dl.arrayBuffer()),
        contentType: dl.headers.get("content-type") ?? acceptMime,
      };
    }
    if (status.status === "FAILED") {
      throw new Error("Lucid export job failed");
    }
    // PENDING / RUNNING → keep polling.
  }
  throw new Error("Lucid export job timed out");
}

// --- Embed -----------------------------------------------------------------

/**
 * Generate a short-lived embed session for a document.
 *
 *   POST /v1/embeds/token   body: { origin }
 *
 * The response body IS the embed session token (a JWT, served as
 * application/jwt — not a JSON envelope). The embed URL is then
 * `https://lucid.app/embeds?token=<jwt>`.
 *
 * Lucid's token embed is origin-bound and picker-based: the token request
 * takes the embedding page's `origin` (required) and an optional `embedId`
 * for a previously-created embed — it is not bound to a document id. The
 * `documentId` parameter is retained for the /api/embed/session route
 * contract but is not sent to Lucid.
 *
 * Ref: https://lucid.readme.io/reference/documentembedstoken
 *      https://lucid.readme.io/docs/tutorial-token-embeds
 *
 * Requires the `lucidchart.document.app.picker.share.embed` OAuth scope.
 */
export async function generateEmbedSession(
  sessionId: string | undefined,
  // Intentionally unused: see the note above on Lucid's origin-bound embed.
  _documentId: string,
): Promise<{ token: string; url: string }> {
  if (isMockMode()) {
    // MOCK: a fake token + valid embed URL format.
    const embedToken = `mock-embed-${Date.now().toString(36)}`;
    return {
      token: embedToken,
      url: `${LUCID_EMBED_BASE}?token=${encodeURIComponent(embedToken)}`,
    };
  }

  const token = await requireToken(sessionId);
  // The origin must match the page that hosts the embed iframe.
  const frontendOrigin = new URL(
    process.env.FRONTEND_URL ?? "http://localhost:5173",
  ).origin;

  const res = await fetch(`${LUCID_API_BASE}/v1/embeds/token`, {
    method: "POST",
    headers: apiHeaders(token, {
      "Content-Type": "application/json",
      Accept: "application/jwt",
    }),
    body: JSON.stringify({ origin: frontendOrigin }),
  });
  if (!res.ok) {
    const detail = await safeErrorText(res);
    // Graceful: surface a clear message (Lucid embed may need a paid plan).
    throw new Error(`Lucid embed session failed (${res.status}): ${detail}`);
  }
  // The token is the raw response body (a JWT string), not a JSON field.
  const embedToken = (await res.text()).trim();
  if (!embedToken) {
    throw new Error("Lucid embed response did not include a token");
  }
  return {
    token: embedToken,
    url: `${LUCID_EMBED_BASE}?token=${encodeURIComponent(embedToken)}`,
  };
}
