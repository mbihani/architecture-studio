// ---------------------------------------------------------------------------
// Thin fetch wrapper for the Architecture Studio backend API.
//
// In development, Vite proxies "/api" to the Express backend on port 3001
// (see vite.config.ts), so all requests are same-origin. In production the
// frontend is served by the same host, so "/api" works there too.
// ---------------------------------------------------------------------------

import type {
  ActivateIndustryResponse,
  AuthStatus,
  CreateDocumentResponse,
  DocumentContents,
  DocumentListItem,
  EmbedSessionResponse,
  Industry,
  LucidImportJson,
} from "../types/index.ts";

const API_BASE = "/api";

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
  if (!res.ok) {
    let detail = `request to ${path} failed`;
    try {
      const body = (await res.json()) as { error?: string; message?: string };
      if (body?.error) detail = body.error;
      else if (body?.message) detail = body.message;
    } catch {
      // Non-JSON error body; keep the generic detail.
    }
    throw new ApiError(res.status, `${res.status}: ${detail}`);
  }
  // Some endpoints (e.g. export) return non-JSON; callers that need the raw
  // response use `rawRequest` instead.
  return (await res.json()) as T;
}

/** A raw fetch that does not parse JSON (used for file downloads). */
export async function rawRequest(path: string, init?: RequestInit): Promise<Response> {
  const res = await fetch(`${API_BASE}${path}`, init);
  if (!res.ok) {
    throw new ApiError(res.status, `${res.status}: request to ${path} failed`);
  }
  return res;
}

/** Request body for POST /api/embed/session. */
interface EmbedSessionRequest {
  documentId: string;
}

/** Request body for POST /api/documents/create. */
interface CreateDocumentRequest {
  importJson: LucidImportJson;
  name: string;
}

export const api = {
  // --- Auth -------------------------------------------------------------
  getAuthStatus: () => request<AuthStatus>("/auth/status"),

  // --- Embed ------------------------------------------------------------
  getEmbedSession: (documentId: string) =>
    request<EmbedSessionResponse>("/embed/session", {
      method: "POST",
      body: JSON.stringify({ documentId } satisfies EmbedSessionRequest),
    }),

  // --- Documents --------------------------------------------------------
  createDocument: (importJson: LucidImportJson, name: string) =>
    request<CreateDocumentResponse>("/documents/create", {
      method: "POST",
      body: JSON.stringify({ importJson, name } satisfies CreateDocumentRequest),
    }),

  listDocuments: () => request<DocumentListItem[]>("/documents"),

  getDocumentContents: (id: string) =>
    request<DocumentContents>(`/documents/${encodeURIComponent(id)}/contents`),

  // --- Industries -------------------------------------------------------
  getIndustries: () => request<Industry[]>("/industries"),

  activateIndustry: (id: string) =>
    request<ActivateIndustryResponse>(
      `/industries/${encodeURIComponent(id)}/activate`,
      { method: "POST" },
    ),

  // --- Export -----------------------------------------------------------
  // Returns the raw Response so the caller can read the blob + filename.
  exportDocument: (id: string) =>
    rawRequest(`/export/${encodeURIComponent(id)}`),
};
