// ---------------------------------------------------------------------------
// App — the Architecture Studio shell.
//
// Layout: a header (title + industry switcher + export button) over a main
// area hosting the editable Lucidchart embed. When the user is not yet
// authenticated with Lucid, the main area shows a "Connect to Lucid" button
// that starts the OAuth flow (GET /api/auth/lucid redirects to Lucid).
//
// Flow:
//   1. GET /api/auth/status  → are we authenticated?
//   2. If yes, GET /api/documents → reuse the first doc, or
//      POST /api/documents/create with an empty Standard Import JSON.
//   3. POST /api/embed/session(documentId) → embed URL for the iframe.
//   4. useDocumentSync polls GET /api/documents/:id/contents.
// ---------------------------------------------------------------------------

import { useEffect, useState } from "react";

import { api, type ApiError } from "./api/client.ts";
import { EmbedFrame } from "./components/EmbedFrame.tsx";
import { ExportButton } from "./components/ExportButton.tsx";
import { Header } from "./components/Header.tsx";
import { IndustrySwitcher } from "./components/IndustrySwitcher.tsx";
import { useDocumentSync } from "./hooks/useDocumentSync.ts";
import { useLucidEmbed } from "./hooks/useLucidEmbed.ts";
import type { LucidImportJson } from "./types/index.ts";

type AuthState = "checking" | "authenticated" | "unauthenticated";

/** An empty Standard Import JSON document used to seed a new Lucid doc. */
const EMPTY_IMPORT: LucidImportJson = {
  version: 1,
  pages: [{ id: "page-1", name: "Platform", shapes: [], lines: [], groups: [] }],
};

const DEFAULT_DOCUMENT_NAME = "Architecture Studio";

export function App(): React.ReactElement {
  const [authState, setAuthState] = useState<AuthState>("checking");
  const [docId, setDocId] = useState<string | null>(null);
  const [bootError, setBootError] = useState<string | null>(null);

  // 1. Check auth status on mount.
  useEffect(() => {
    let cancelled = false;
    api
      .getAuthStatus()
      .then((status) => {
        if (cancelled) return;
        setAuthState(status.authenticated ? "authenticated" : "unauthenticated");
      })
      .catch((err: ApiError) => {
        if (cancelled) return;
        setBootError(err.message);
        setAuthState("unauthenticated");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // 2. Once authenticated, ensure we have a document to embed.
  useEffect(() => {
    if (authState !== "authenticated") return;
    let cancelled = false;

    (async () => {
      try {
        const docs = await api.listDocuments();
        if (cancelled) return;
        if (docs.length > 0) {
          setDocId(docs[0].id);
          return;
        }
        const created = await api.createDocument(EMPTY_IMPORT, DEFAULT_DOCUMENT_NAME);
        if (cancelled) return;
        setDocId(created.id);
      } catch (err) {
        if (!cancelled) setBootError((err as ApiError).message);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [authState]);

  // 3. Request an embed session for the current document.
  const embed = useLucidEmbed(docId);

  // 4. Poll the document contents (readback sync).
  const sync = useDocumentSync(docId, authState === "authenticated" && !!docId);

  return (
    <div className="app">
      <Header
        title="Architecture Studio"
        controls={
          <>
            <IndustrySwitcher />
            <ExportButton documentId={docId} />
          </>
        }
      />

      <main className="app-main">
        {authState === "checking" && (
          <div className="app-placeholder">Checking Lucid connection…</div>
        )}

        {authState === "unauthenticated" && (
          <div className="app-placeholder">
            <p>Connect your Lucid account to start editing architectures.</p>
            <a className="connect-button" href="/api/auth/lucid">
              Connect to Lucid
            </a>
            {bootError && (
              <p className="app-placeholder__error" title={bootError}>
                {bootError}
              </p>
            )}
          </div>
        )}

        {authState === "authenticated" && (
          <>
            {!embed.url && (
              <div className="app-placeholder">
                {embed.loading
                  ? "Preparing Lucidchart canvas…"
                  : embed.error ?? bootError ?? "Loading…"}
              </div>
            )}
            {embed.url && <EmbedFrame url={embed.url} />}
            {sync.error && (
              <div className="app-sync-error" title={sync.error}>
                sync: {sync.error}
              </div>
            )}
          </>
        )}
      </main>
    </div>
  );
}

export default App;
