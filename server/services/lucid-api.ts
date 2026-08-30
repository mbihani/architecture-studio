// ---------------------------------------------------------------------------
// Wrapper for the Lucid REST API.
//
// Every call below is structured to match Lucid's documented endpoints so that
// real credentials "just work" once LUCID_CLIENT_ID / LUCID_CLIENT_SECRET are
// configured. While credentials are absent the calls return clearly-marked
// MOCK responses so the app shell is fully exercisable end-to-end.
//
// References:
//   - Standard Import JSON: https://developer.lucid.co/docs/overview-si
//   - REST API:             https://developer.lucid.co/docs/
// ---------------------------------------------------------------------------

import { getValidAccessToken } from "./lucid-oauth.ts";
import type { LucidImportJson } from "../types.ts";

// TODO: confirm the exact Lucid REST base + endpoint paths against
// https://developer.lucid.co/docs/ and replace the placeholders below.
// Used by the real fetch calls in the TODO stubs below.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const LUCID_API_BASE = "https://lucid.app/api";
const LUCID_EMBED_BASE = "https://lucid.app/embeds";

/** Whether real Lucid credentials are configured. */
function hasCredentials(): boolean {
  return (
    !!process.env.LUCID_CLIENT_ID && !!process.env.LUCID_CLIENT_SECRET
  );
}

export interface LucidDocumentRef {
  id: string;
  name: string;
}

/**
 * Create a Lucid document from Standard Import JSON.
 *
 * Real flow: package `importJson` as a .lucid archive (ZIP of document.json)
 * and POST it to Lucid's document-creation endpoint with the access token.
 *
 * TODO: implement the real archive + POST once credentials are available.
 */
export async function createDocumentFromImport(
  importJson: LucidImportJson,
  name: string,
): Promise<LucidDocumentRef> {
  const token = await getValidAccessToken();
  if (token && hasCredentials()) {
    // TODO: real implementation sketch:
    // const archive = await buildLucidArchive(importJson); // zip document.json
    // const res = await fetch(`${LUCID_API_BASE}/documents`, {
    //   method: "POST",
    //   headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/zip" },
    //   body: archive,
    // });
    // const doc = await res.json();
    // return { id: doc.id, name: doc.name };
    void importJson;
  }

  // MOCK: synthesize a stable-looking document id.
  const id = `doc-${Math.random().toString(36).slice(2, 10)}`;
  return { id, name };
}

/**
 * List the user's Lucid documents.
 *
 * TODO: GET `${LUCID_API_BASE}/documents` with the access token.
 */
export async function listDocuments(): Promise<LucidDocumentRef[]> {
  const token = await getValidAccessToken();
  if (token && hasCredentials()) {
    // TODO: const res = await fetch(`${LUCID_API_BASE}/documents`, {
    //   headers: { Authorization: `Bearer ${token}` },
    // });
    // return await res.json();
  }

  // MOCK: a single demo document so the app shell has something to embed.
  return [{ id: "doc-demo", name: "Architecture Studio (demo)" }];
}

/**
 * Read back a document's contents (pages/shapes/lines).
 *
 * TODO: GET `${LUCID_API_BASE}/documents/${id}/contents` with the access token
 * and map the Lucid response into our read-back shape.
 */
export async function getDocumentContents(
  id: string,
): Promise<{ id: string; pages: LucidImportJson["pages"]; updatedAt?: number }> {
  const token = await getValidAccessToken();
  if (token && hasCredentials()) {
    // TODO: const res = await fetch(`${LUCID_API_BASE}/documents/${id}/contents`, {
    //   headers: { Authorization: `Bearer ${token}` },
    // });
    // const data = await res.json();
    // return { id, pages: data.pages, updatedAt: Date.now() };
    void token;
  }

  // MOCK: an empty page so the readback poll succeeds.
  return {
    id,
    pages: [
      { id: "page-1", name: "Platform", shapes: [], lines: [], groups: [] },
    ],
    updatedAt: Date.now(),
  };
}

/**
 * Export a document as PNG or PDF.
 *
 * TODO: GET `${LUCID_API_BASE}/documents/${id}/export?format=${format}` with
 * the access token and stream the binary response back.
 */
export async function exportDocument(
  id: string,
  format: "png" | "pdf" = "png",
): Promise<{ buffer: Buffer; contentType: string }> {
  const token = await getValidAccessToken();
  if (token && hasCredentials()) {
    // TODO: const res = await fetch(
    //   `${LUCID_API_BASE}/documents/${id}/export?format=${format}`,
    //   { headers: { Authorization: `Bearer ${token}` } },
    // );
    // return { buffer: Buffer.from(await res.arrayBuffer()),
    //          contentType: res.headers.get("content-type") ?? "application/octet-stream" };
    void token;
  }

  // MOCK: a placeholder payload so the export path is exercisable.
  return {
    buffer: Buffer.from(`mock ${format} export for ${id}`),
    contentType: format === "pdf" ? "application/pdf" : "image/png",
  };
}

/**
 * Generate a short-lived embed session for a document.
 *
 * Real flow: POST to Lucid's embed-session endpoint with the document id and
 * editor scope; Lucid returns a token to append to the embed URL.
 *
 * TODO: implement the real session endpoint once credentials are available.
 * The embed URL shape is https://lucid.app/embeds?token=...&mode=editor.
 */
export async function generateEmbedSession(
  documentId: string,
): Promise<{ token: string; url: string }> {
  const token = await getValidAccessToken();
  if (token && hasCredentials()) {
    // TODO: const res = await fetch(`${LUCID_API_BASE}/embed/sessions`, {
    //   method: "POST",
    //   headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    //   body: JSON.stringify({ documentId, mode: "editor" }),
    // });
    // const data = await res.json();
    // return { token: data.token, url: `${LUCID_EMBED_BASE}?token=${data.token}&mode=editor` };
    void token;
  }

  // MOCK: a fake token + valid embed URL format.
  const embedToken = `mock-embed-${Date.now().toString(36)}`;
  return {
    token: embedToken,
    url: `${LUCID_EMBED_BASE}?token=${embedToken}&mode=editor&documentId=${encodeURIComponent(documentId)}`,
  };
}
