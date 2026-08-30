// ---------------------------------------------------------------------------
// useDocumentSync — polls GET /api/documents/:id/contents on an interval.
//
// Lucid has no change webhook, so the frontend mirrors the document into our
// ArchitectureDoc shape by polling the read-back endpoint. The hook is enabled
// only when a document id is present and an `enabled` flag is true.
// ---------------------------------------------------------------------------

import { useEffect, useRef, useState } from "react";

import { api, type ApiError } from "../api/client.ts";
import type { DocumentContents } from "../types/index.ts";

interface UseDocumentSyncResult {
  contents: DocumentContents | null;
  loading: boolean;
  error: string | null;
  /** Epoch ms of the last successful sync. */
  lastSyncedAt: number | null;
}

const DEFAULT_INTERVAL_MS = 5000;

export function useDocumentSync(
  documentId: string | null,
  enabled = true,
  intervalMs = DEFAULT_INTERVAL_MS,
): UseDocumentSyncResult {
  const [contents, setContents] = useState<DocumentContents | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastSyncedAt, setLastSyncedAt] = useState<number | null>(null);

  // Keep the latest document id in a ref so the interval callback can read it
  // without re-arming the interval on every id change.
  const idRef = useRef(documentId);
  idRef.current = documentId;

  useEffect(() => {
    if (!documentId || !enabled) {
      return;
    }

    let cancelled = false;

    const sync = async () => {
      const id = idRef.current;
      if (!id) return;
      setLoading(true);
      try {
        const data = await api.getDocumentContents(id);
        if (cancelled) return;
        setContents(data);
        setError(null);
        setLastSyncedAt(Date.now());
      } catch (err) {
        if (cancelled) return;
        setError((err as ApiError).message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    // Sync immediately, then on the interval.
    void sync();
    const handle = setInterval(() => void sync(), intervalMs);

    return () => {
      cancelled = true;
      clearInterval(handle);
    };
  }, [documentId, enabled, intervalMs]);

  return { contents, loading, error, lastSyncedAt };
}
