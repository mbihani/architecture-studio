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

import { EmbedFrame } from "./components/EmbedFrame.tsx";
import { ExportButton } from "./components/ExportButton.tsx";
import { Header } from "./components/Header.tsx";
import { IndustrySwitcher } from "./components/IndustrySwitcher.tsx";
import { useDrawioEmbed } from "./hooks/useDrawioEmbed.ts";

export function App(): React.ReactElement {
  const { iframeRef, loading, error, exportPng, switchPage } = useDrawioEmbed();

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
        {!loading && !error && <EmbedFrame iframeRef={iframeRef} />}
      </main>
    </div>
  );
}

export default App;
