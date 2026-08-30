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
//
// Diagnostics: a collapsible bottom panel shows the live diagnostic log at
// all times. When the embed fails (status "error"), the main area is replaced
// by a large diagnostic panel with the full event history so the developer
// can see exactly what went wrong without opening the browser console.
// ---------------------------------------------------------------------------

import { useEffect, useRef, useState } from "react";

import { EmbedFrame } from "./components/EmbedFrame.tsx";
import { ExportButton } from "./components/ExportButton.tsx";
import { Header } from "./components/Header.tsx";
import { IndustrySwitcher } from "./components/IndustrySwitcher.tsx";
import {
  useDrawioEmbed,
  type DrawioStatus,
  type DiagnosticEntry,
} from "./hooks/useDrawioEmbed.ts";

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

// ---------------------------------------------------------------------------
// DiagnosticLog — shared scrollable list of diagnostic entries (newest first).
// Used by both the error diagnostic panel (main area) and the collapsible
// bottom console. The container styling adapts via CSS based on the parent.
// ---------------------------------------------------------------------------

function DiagnosticLog({
  entries,
}: {
  entries: DiagnosticEntry[];
}): React.ReactElement {
  // Newest first — reverse a copy so we don't mutate the source array.
  const reversed = [...entries].reverse();
  return (
    <div className="diag-log">
      {reversed.map((entry, i) => (
        <div key={i} className="diag-log-entry">
          <span className="diag-log-entry__time">{entry.time}</span>
          <span className="diag-log-entry__event">{entry.event}</span>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// ErrorDiagnosticPanel — replaces the main area when status is "error".
// Shows the error message, the last state before the failure, and the full
// diagnostic log so the developer can trace exactly what happened. Dark,
// monospace, developer-diagnostic styling.
// ---------------------------------------------------------------------------

interface ErrorDiagnosticPanelProps {
  error: string;
  lastStatus: DrawioStatus;
  diagnosticLog: DiagnosticEntry[];
}

function ErrorDiagnosticPanel({
  error,
  lastStatus,
  diagnosticLog,
}: ErrorDiagnosticPanelProps): React.ReactElement {
  return (
    <div className="diag-error-panel">
      <div className="diag-error-panel__header">
        <span className="diag-error-panel__title">
          {"⚠ draw.io embed failed to initialize"}
        </span>
        <button
          className="diag-error-panel__retry"
          onClick={() => window.location.reload()}
        >
          Retry
        </button>
      </div>
      <div className="diag-error-panel__error-msg">{error}</div>
      <div className="diag-error-panel__last-status">
        Last state before error: {lastStatus}
      </div>
      <div className="diag-error-panel__log-title">
        Diagnostic log (newest first):
      </div>
      <DiagnosticLog entries={diagnosticLog} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// DiagnosticConsole — a collapsible bottom panel (like dev tools console)
// that shows the live diagnostic log. Always visible; starts collapsed with a
// toggle button labeled "Diagnostics" showing the entry count.
// ---------------------------------------------------------------------------

function DiagnosticConsole({
  diagnosticLog,
}: {
  diagnosticLog: DiagnosticEntry[];
}): React.ReactElement {
  const [open, setOpen] = useState(false);
  return (
    <div className={`diag-console${open ? " diag-console--open" : ""}`}>
      <button
        className="diag-console__toggle"
        onClick={() => setOpen((prev) => !prev)}
      >
        Diagnostics {open ? "▾" : "▸"} ({diagnosticLog.length})
      </button>
      {open && <DiagnosticLog entries={diagnosticLog} />}
    </div>
  );
}

export function App(): React.ReactElement {
  const {
    iframeRef,
    loading,
    error,
    status,
    embedUrl,
    diagnosticLog,
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
          <ErrorDiagnosticPanel
            error={error}
            lastStatus={lastStatusRef.current}
            diagnosticLog={diagnosticLog}
          />
        )}
        {!loading && !error && (
          <EmbedFrame
            iframeRef={iframeRef}
            embedUrl={embedUrl}
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

      <DiagnosticConsole diagnosticLog={diagnosticLog} />
    </div>
  );
}

export default App;
