// ---------------------------------------------------------------------------
// ExportButton — download the current document as ArchitectureDoc JSON.
//
// Calls GET /api/export/:id (which reads back the Lucid doc, converts it to
// our ArchitectureDoc JSON, and returns it as a file download) and saves the
// attachment locally.
// ---------------------------------------------------------------------------

import { useState } from "react";

import { api, type ApiError } from "../api/client.ts";

interface ExportButtonProps {
  /** The Lucid document id to export. Disabled when null. */
  documentId: string | null;
}

/** Pull a filename from the Content-Disposition header, with a fallback. */
function filenameFromResponse(res: Response, fallback: string): string {
  const cd = res.headers.get("content-disposition") ?? "";
  const match = /filename="?([^";]+)"?/i.exec(cd);
  return match ? match[1] : fallback;
}

export function ExportButton({ documentId }: ExportButtonProps): React.ReactElement {
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleExport = async () => {
    if (!documentId) return;
    setExporting(true);
    setError(null);
    try {
      const res = await api.exportDocument(documentId);
      const blob = await res.blob();
      const filename = filenameFromResponse(
        res,
        `architecture-${documentId}.json`,
      );
      // Trigger a browser download for the blob.
      const objectUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = objectUrl;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(objectUrl);
    } catch (err) {
      setError((err as ApiError).message);
    } finally {
      setExporting(false);
    }
  };

  return (
    <button
      type="button"
      className="export-button"
      onClick={handleExport}
      disabled={!documentId || exporting}
      title={error ?? "Export architecture as JSON"}
    >
      {exporting ? "Exporting…" : "Export JSON"}
      {error && <span className="export-button__error" title={error}> ⚠</span>}
    </button>
  );
}

export default ExportButton;
