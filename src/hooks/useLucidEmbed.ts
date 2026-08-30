// ---------------------------------------------------------------------------
// useLucidEmbed — requests a short-lived Lucid embed session for a document.
//
// The backend (POST /api/embed/session) returns { token, url } where `url` is
// the full https://lucid.app/embeds?token=... address to load in the iframe.
// This hook owns that request lifecycle.
// ---------------------------------------------------------------------------

import { useEffect, useState } from "react";

import { api, type ApiError } from "../api/client.ts";
import type { EmbedSessionResponse } from "../types/index.ts";

interface UseLucidEmbedResult {
  /** The embed session URL to load in the iframe, or null while loading. */
  url: string | null;
  token: string | null;
  loading: boolean;
  error: string | null;
}

export function useLucidEmbed(documentId: string | null): UseLucidEmbedResult {
  const [url, setUrl] = useState<string | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!documentId) {
      setUrl(null);
      setToken(null);
      setError(null);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);

    api
      .getEmbedSession(documentId)
      .then((res: EmbedSessionResponse) => {
        if (cancelled) return;
        setUrl(res.url);
        setToken(res.token);
      })
      .catch((err: ApiError) => {
        if (cancelled) return;
        setError(err.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [documentId]);

  return { url, token, loading, error };
}
