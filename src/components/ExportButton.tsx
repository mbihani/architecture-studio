// ---------------------------------------------------------------------------
// ExportButton — download the current diagram as an SVG file.
//
// Export is handled entirely client-side: the hook's saveSvgToFile() builds a
// Blob from the current page's SVG markup and triggers a download. No backend
// round-trip, no iframe, no data-URI gymnastics.
// ---------------------------------------------------------------------------

import { useState } from "react";

interface ExportButtonProps {
  /** Download the current diagram as an SVG file. */
  onExport: () => void;
}

export function ExportButton({ onExport }: ExportButtonProps): React.ReactElement {
  const [done, setDone] = useState(false);

  const handleExport = () => {
    onExport();
    // Brief visual confirmation that the download was triggered.
    setDone(true);
    window.setTimeout(() => setDone(false), 1200);
  };

  return (
    <button
      type="button"
      className="export-button"
      onClick={handleExport}
      title="Download the current diagram as SVG"
    >
      {done ? "Exported ✓" : "Export SVG"}
    </button>
  );
}

export default ExportButton;
