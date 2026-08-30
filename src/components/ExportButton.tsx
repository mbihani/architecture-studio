// ---------------------------------------------------------------------------
// ExportButton — download the current diagram as a PNG image.
//
// Export is handled entirely client-side via the draw.io postMessage
// protocol: the hook's exportPng() sends {action: "export", format: "png"}
// to the iframe and resolves with a PNG data URI. No backend round-trip.
// ---------------------------------------------------------------------------

import { useState } from "react";

interface ExportButtonProps {
  /** Export the current diagram as PNG; resolves with a PNG data URI. */
  onExport: () => Promise<string>;
}

export function ExportButton({ onExport }: ExportButtonProps): React.ReactElement {
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleExport = async () => {
    setExporting(true);
    setError(null);
    try {
      // draw.io returns a ready-to-use data URI (data:image/png;base64,…).
      const dataUri = await onExport();
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
