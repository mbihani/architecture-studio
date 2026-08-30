// ---------------------------------------------------------------------------
// App — the Architecture Studio shell.
//
// Layout: a header (title + industry switcher + export button) over a main
// area hosting a client-side SVG renderer of the architecture diagrams.
//
// Flow:
//   1. useArchitectureView loads the architecture mxfile XML from
//      GET /api/architecture and renders every <diagram> page to an SVG
//      string — no iframe, no embed, no external network dependency.
//   2. SvgViewer displays the current page with pan/zoom.
//   3. The industry switcher switches the visible SVG page.
//   4. The export button downloads the current page as an SVG file.
//
// No StatusOverlay — there is no embed lifecycle to track.
// ---------------------------------------------------------------------------

import { ExportButton } from "./components/ExportButton.tsx";
import { Header } from "./components/Header.tsx";
import { IndustrySwitcher } from "./components/IndustrySwitcher.tsx";
import { SvgViewer } from "./components/SvgViewer.tsx";
import { useArchitectureView } from "./hooks/useArchitectureView.ts";

export function App(): React.ReactElement {
  const { pages, currentPageId, loading, error, switchPage, saveSvgToFile } =
    useArchitectureView();
  const current = pages.find((p) => p.id === currentPageId);

  return (
    <div className="app">
      <Header
        title="Architecture Studio"
        controls={
          <>
            <IndustrySwitcher onActivate={switchPage} />
            <ExportButton onExport={saveSvgToFile} />
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
        {!loading && !error && current && <SvgViewer svg={current.svg} />}
        {!loading && !error && !current && (
          <div className="app-placeholder">No diagram to display.</div>
        )}
      </main>
    </div>
  );
}

export default App;
