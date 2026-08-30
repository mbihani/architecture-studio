// ---------------------------------------------------------------------------
// App — the Architecture Studio shell.
//
// Layout: a header (title + industry switcher + export button) over a main
// area hosting the draw.io (diagrams.net) embeddable editor.
//
// Flow:
//   1. useDrawioEmbed loads the full architecture mxfile XML from
//      GET /api/architecture (all pages as tabs).
//   2. Once loaded, EmbedFrame renders the draw.io iframe; the hook drives the
//      postMessage protocol (init → load, save → persist, export → PNG).
//   3. The industry switcher switches the editor to the selected page tab
//      (all pages preserved — see useDrawioEmbed.switchPage).
//
// No auth, no OAuth, no document lifecycle — the draw.io embed is free and
// keyless.
// ---------------------------------------------------------------------------

import { useEffect, useRef, useState } from "react";

import { EmbedFrame } from "./components/EmbedFrame.tsx";
import { ExportButton } from "./components/ExportButton.tsx";
import { Header } from "./components/Header.tsx";
import { IndustrySwitcher } from "./components/IndustrySwitcher.tsx";
import { useDrawioEmbed, type DrawioStatus } from "./hooks/useDrawioEmbed.ts";

// ---------------------------------------------------------------------------
// StatusOverlay — a small, dismissible badge in the bottom-right corner that
// surfaces the draw.io embed lifecycle so the load is observable without a
// browser console. Auto-hides 5s after the terminal "loaded" state; errors
// stay visible (in red) until dismissed. Click anywhere on it to dismiss.
// ---------------------------------------------------------------------------

const STATUS_TEXT: Record<Exclude<DrawioStatus, "error">, string> = {
  fetching: "Fetching architecture…",
  "iframe-loading": "Editor iframe loaded, waiting for init…",
  "init-waiting": "Editor initializing…",
  "loading-xml": "Editor ready, loading XML…",
  loaded: "XML loaded ✓",
};

interface StatusOverlayProps {
  status: DrawioStatus;
  error: string | null;
  /** The last non-error status before the failure — shown for diagnostics. */
  lastStatus: DrawioStatus;
}

function StatusOverlay({
  status,
  error,
  lastStatus,
}: StatusOverlayProps): React.ReactElement | null {
  const [hidden, setHidden] = useState(false);

  // Auto-hide 5s after reaching the terminal "loaded" state; re-show on any
  // later state change (e.g. an error after a successful load).
  useEffect(() => {
    if (status !== "loaded") {
      setHidden(false);
      return;
    }
    const timer = setTimeout(() => setHidden(true), 5000);
    return () => clearTimeout(timer);
  }, [status]);

  if (hidden) return null;

  const text =
    status === "error"
      ? `Error: ${error ?? "unknown"} (last state: ${lastStatus})`
      : STATUS_TEXT[status];
  return (
    <div
      className={
        status === "error"
          ? "status-overlay status-overlay--error"
          : "status-overlay"
      }
      role="status"
      onClick={() => setHidden(true)}
      title="click to dismiss"
    >
      {text}
      {status === "error" && (
        <button
          className="status-overlay__retry"
          onClick={(e) => {
            e.stopPropagation();
            window.location.reload();
          }}
        >
          Retry
        </button>
      )}
    </div>
  );
}

export function App(): React.ReactElement {
  const {
    iframeRef,
    loading,
    error,
    status,
    exportPng,
    switchPage,
    onIframeLoad,
    onIframeError,
  } = useDrawioEmbed();

  // Track the last non-error status so the error overlay can show what state
  // preceded the failure (e.g. "iframe-loading" → the iframe loaded but init
  // never fired; "fetching" → the iframe never even loaded).
  const lastStatusRef = useRef<DrawioStatus>("fetching");
  useEffect(() => {
    if (status !== "error") {
      lastStatusRef.current = status;
    }
  }, [status]);

  return (
    <div className="app">
      <Header
        title="Architecture Studio"
        controls={
          <>
            <IndustrySwitcher onActivate={switchPage} />
            <ExportButton onExport={exportPng} />
          </>
        }
      />

      <main className="app-main">
        {loading && (
          <div className="app-placeholder">Loading architecture…</div>
        )}
        {!loading && error && (
          <div className="app-placeholder">
            <p className="app-placeholder__error" title={error}>
              {error}
            </p>
          </div>
        )}
        {!loading && !error && (
          <EmbedFrame
            iframeRef={iframeRef}
            onIframeLoad={onIframeLoad}
            onIframeError={onIframeError}
          />
        )}
        <StatusOverlay
          status={status}
          error={error}
          lastStatus={lastStatusRef.current}
        />
      </main>
    </div>
  );
}

export default App;
