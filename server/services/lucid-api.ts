// ---------------------------------------------------------------------------
// Wrapper for the Lucid REST API (https://api.lucid.co).
//
// Every function makes a real `fetch` call against Lucid's documented
// endpoints. When LUCID_CLIENT_ID / LUCID_CLIENT_SECRET are not configured
// (mock mode) the functions return clearly-marked MOCK responses so the app
// shell is fully exercisable end-to-end without real credentials.
//
// References:
//   - Standard Import JSON: https://developer.lucid.co/docs/overview-si
//   - REST API:             https://developer.lucid.co/docs/
//
// NOTE: some Lucid API features (e.g. programmatic document creation and the
// embed-session endpoint) may require a paid Lucid plan. Where that applies
// the real call is still made and any error is surfaced to the caller; TODOs
// mark only the spots whose exact request/response shape should be confirmed
// against live credentials.
// ---------------------------------------------------------------------------

import { getValidAccessToken, isMockMode } from "./lucid-oauth.ts";
import type { LucidImportJson } from "../types.ts";

const LUCID_API_BASE = "https://api.lucid.co";
const LUCID_EMBED_BASE = "https://lucid.app/embeds";

export interface LucidDocumentRef {
  id: string;
  name: string;
}

/** Loose shape for a Lucid document reference in list/create responses. */
interface LucidApiDocument {
  documentId?: string;
  id?: string;
  name?: string;
  title?: string;
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

// --- Document lifecycle ----------------------------------------------------

/**
 * Create a Lucid document from Standard Import JSON.
 *
 * The import JSON is packaged as a .lucid archive (ZIP of document.json) and
 * POSTed to Lucid's document-creation endpoint.
 *
 * TODO: confirm the exact create endpoint / content-type against live Lucid
 * credentials — Lucid may require a paid plan for programmatic creation.
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

  const res = await fetch(`${LUCID_API_BASE}/documents`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/zip",
    },
    body: archive,
  });
  if (!res.ok) {
    const detail = await safeErrorText(res);
    throw new Error(`Lucid create document failed (${res.status}): ${detail}`);
  }
  const doc = (await res.json()) as LucidApiDocument;
  return { id: doc.documentId ?? doc.id ?? "", name: doc.name ?? doc.title ?? name };
}

/**
 * List the user's Lucid documents.
 *
 * TODO: confirm the exact list response shape against live credentials.
 */
export async function listDocuments(
  sessionId: string | undefined,
): Promise<LucidDocumentRef[]> {
  if (isMockMode()) {
    // MOCK: a single demo document so the app shell has something to embed.
    return [{ id: "doc-demo", name: "Architecture Studio (demo)" }];
  }

  const token = await requireToken(sessionId);
  const res = await fetch(`${LUCID_API_BASE}/documents`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    const detail = await safeErrorText(res);
    throw new Error(`Lucid list documents failed (${res.status}): ${detail}`);
  }
  const data = (await res.json()) as LucidApiDocument[] | { documents?: LucidApiDocument[] };
  const items = Array.isArray(data) ? data : (data.documents ?? []);
  return items.map((d) => ({
    id: d.documentId ?? d.id ?? "",
    name: d.name ?? d.title ?? "Untitled",
  }));
}

/**
 * Read back a document's contents (pages/shapes/lines).
 *
 * TODO: map the exact Lucid contents response to our LucidPage[] shape once
 * verified against live credentials — Lucid's readback shape may differ.
 */
export async function getDocumentContents(
  sessionId: string | undefined,
  id: string,
): Promise<{ id: string; pages: LucidImportJson["pages"]; updatedAt?: number }> {
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
    `${LUCID_API_BASE}/documents/${encodeURIComponent(id)}/contents`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  if (!res.ok) {
    const detail = await safeErrorText(res);
    throw new Error(`Lucid readback failed (${res.status}): ${detail}`);
  }
  const data = (await res.json()) as { pages?: LucidImportJson["pages"] };
  return { id, pages: data.pages ?? [], updatedAt: Date.now() };
}

/**
 * Export a document as PNG or PDF.
 *
 * POSTs to Lucid's export endpoint. Lucid may return the binary directly or a
 * JSON envelope containing a download URL; both are handled.
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
  const res = await fetch(
    `${LUCID_API_BASE}/documents/${encodeURIComponent(id)}/export`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ format }),
    },
  );
  if (!res.ok) {
    const detail = await safeErrorText(res);
    throw new Error(`Lucid export failed (${res.status}): ${detail}`);
  }
  const contentType = res.headers.get("content-type") ?? "application/octet-stream";
  // Lucid may return a JSON envelope with a download URL instead of raw bytes.
  if (contentType.includes("application/json")) {
    const data = (await res.json()) as { url?: string };
    if (data.url) {
      const dl = await fetch(data.url);
      return {
        buffer: Buffer.from(await dl.arrayBuffer()),
        contentType: dl.headers.get("content-type") ?? contentType,
      };
    }
  }
  return {
    buffer: Buffer.from(await res.arrayBuffer()),
    contentType,
  };
}

// --- Embed -----------------------------------------------------------------

/**
 * Generate a short-lived embed session for a document.
 *
 * Real flow: POST to Lucid's embed endpoint with the access token to obtain an
 * embed token, then build the iframe URL `https://lucid.app/embeds?token=...`.
 *
 * Lucid's embed API may require a paid plan — the call is made regardless and
 * any error (e.g. 402/403) is surfaced to the caller so the frontend can show
 * a clear message instead of a broken iframe.
 */
export async function generateEmbedSession(
  sessionId: string | undefined,
  documentId: string,
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
  const res = await fetch(
    `${LUCID_API_BASE}/documents/${encodeURIComponent(documentId)}/embed`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ mode: "editor" }),
    },
  );
  if (!res.ok) {
    const detail = await safeErrorText(res);
    // Graceful: surface a clear message (Lucid embed may need a paid plan).
    throw new Error(`Lucid embed session failed (${res.status}): ${detail}`);
  }
  const data = (await res.json()) as {
    token?: string;
    embedToken?: string;
    accessToken?: string;
  };
  const embedToken = data.token ?? data.embedToken ?? data.accessToken ?? "";
  if (!embedToken) {
    throw new Error("Lucid embed response did not include a token");
  }
  return {
    token: embedToken,
    url: `${LUCID_EMBED_BASE}?token=${encodeURIComponent(embedToken)}`,
  };
}
