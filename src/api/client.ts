// ---------------------------------------------------------------------------
// Thin fetch wrapper for the Architecture Studio backend API.
//
// In development, Vite proxies "/api" to the Express backend (see
// vite.config.ts), so all requests are same-origin. In production the
// frontend is served by the same host, so "/api" works there too.
// ---------------------------------------------------------------------------

import type {
  ActivateIndustryResponse,
  ArchitectureResponse,
  Industry,
  SaveArchitectureResponse,
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
  return (await res.json()) as T;
}

/** Request body for POST /api/architecture. */
interface SaveArchitectureRequest {
  drawioXml: string;
}

export const api = {
  // --- Architecture (draw.io XML) ---------------------------------------
  /** Fetch the full architecture mxfile XML. */
  getArchitecture: () => request<ArchitectureResponse>("/architecture"),

  /** Persist the edited architecture mxfile XML. */
  saveArchitecture: (drawioXml: string) =>
    request<SaveArchitectureResponse>("/architecture", {
      method: "POST",
      body: JSON.stringify({ drawioXml } satisfies SaveArchitectureRequest),
    }),

  // --- Industries -------------------------------------------------------
  getIndustries: () => request<Industry[]>("/industries"),

  /** Activate an industry (backend bookkeeping); the editor switches page client-side. */
  activateIndustry: (id: string) =>
    request<ActivateIndustryResponse>(
      `/industries/${encodeURIComponent(id)}/activate`,
      { method: "POST" },
    ),
};
