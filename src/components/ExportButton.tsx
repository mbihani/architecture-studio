// ---------------------------------------------------------------------------
// ExportButton — download the current diagram as a PNG image.
//
// Export is handled entirely client-side via the draw.io postMessage
// protocol: the hook's exportPng() sends {action: "export", format: "png"}
// to the iframe and resolves with base64 PNG data. No backend round-trip.
// ---------------------------------------------------------------------------

import { useState } from "react";

interface ExportButtonProps {
  /** Export the current diagram as PNG; resolves with raw base64 data. */
  onExport: () => Promise<string>;
}

export function ExportButton({ onExport }: ExportButtonProps): React.ReactElement {
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleExport = async () => {
    setExporting(true);
    setError(null);
    try {
      const base64 = await onExport();
      // draw.io returns raw base64 PNG data; create a data URI for download.
      const dataUri = `data:image/png;base64,${base64}`;
      const a = document.createElement("a");
      a.href = dataUri;
      a.download = "architecture.png";
      document.body.appendChild(a);
      a.click();
      a.remove();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setExporting(false);
    }
  };

  return (
    <button
      type="button"
      className="export-button"
      onClick={handleExport}
      disabled={exporting}
      title={error ?? "Export diagram as PNG"}
    >
      {exporting ? "Exporting…" : "Export PNG"}
      {error && <span className="export-button__error" title={error}> ⚠</span>}
    </button>
  );
}

export default ExportButton;
