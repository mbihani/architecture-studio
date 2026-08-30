// ---------------------------------------------------------------------------
// useArchitectureView — owns the architecture diagram view, replacing the
// old draw.io embed hook.
//
// The hook loads the full architecture mxfile XML from GET /api/architecture
// on mount, renders every <diagram> page to an SVG string (client-side, via
// drawio-to-svg — no iframe, no network), and exposes the rendered pages plus
// helpers to switch pages and download the current page as an SVG file.
//
// No postMessage, no embed lifecycle — just fetch → parse → render → display.
// ---------------------------------------------------------------------------

import { useCallback, useEffect, useState } from "react";

import { api, type ApiError } from "../api/client.ts";
import { drawioToSvg, type SvgPage } from "../lib/drawio-to-svg.ts";

interface UseArchitectureViewResult {
  /** All rendered diagram pages, in document order. */
  pages: SvgPage[];
  /** The id of the page currently on display. */
  currentPageId: string;
  /** True while the initial XML is being fetched and rendered. */
  loading: boolean;
  /** Error message if the initial fetch or render failed. */
  error: string | null;
  /** Switch the visible page to the given industry/diagram id. */
  switchPage: (id: string) => void;
  /** Download the current page as an SVG file. */
  saveSvgToFile: () => void;
}

export function useArchitectureView(): UseArchitectureViewResult {
  const [pages, setPages] = useState<SvgPage[]>([]);
  const [currentPageId, setCurrentPageId] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Fetch the architecture XML once on mount, then render every page to SVG.
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    api
      .getArchitecture()
      .then(async (res) => {
        const rendered = await drawioToSvg(res.drawioXml);
        if (cancelled) return;
        if (rendered.length === 0) {
          setError("No diagram pages found in the architecture file.");
          return;
        }
        setPages(rendered);
        setCurrentPageId(rendered[0].id);
      })
      .catch((err: ApiError) => {
        if (!cancelled) setError(err.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  /** Switch the visible page (and notify the backend for bookkeeping). */
  const switchPage = useCallback(
    (id: string): void => {
      setCurrentPageId(id);
      // Best-effort activation; the view switches client-side regardless.
      api.activateIndustry(id).catch(() => {
        /* activation is bookkeeping only — ignore failures */
      });
    },
    [],
  );

  /** Download the current page's SVG as a file. */
  const saveSvgToFile = useCallback((): void => {
    const page = pages.find((p) => p.id === currentPageId);
    if (!page) return;
    const blob = new Blob([page.svg], { type: "image/svg+xml" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${page.name || page.id}.svg`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }, [pages, currentPageId]);

  return { pages, currentPageId, loading, error, switchPage, saveSvgToFile };
}
