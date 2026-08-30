// ---------------------------------------------------------------------------
// useDrawioEmbed — owns the draw.io (diagrams.net) embed lifecycle.
//
// The hook loads the architecture mxfile XML from GET /api/architecture on
// mount, renders the editor iframe (via the returned ref), and drives the
// postMessage protocol:
//
//   init   → configure + load the XML into the editor
//   save   → persist the XML via POST /api/architecture
//   export → resolve a promise with base64 PNG data
//
// No OAuth, no polling — all communication is event-driven postMessage.
// ---------------------------------------------------------------------------

import { useCallback, useEffect, useRef, useState } from "react";

import { api, type ApiError } from "../api/client.ts";

/** The embed URL for the diagrams.net editor (no API key, no OAuth). */
export const DRAWIO_EMBED_URL =
  "https://embed.diagrams.net?proto=json&svg=1&splash=0";

/** Messages sent TO the draw.io editor iframe (actions). */
type DrawioAction =
  | { action: "configure"; config: Record<string, unknown> }
  | { action: "load"; xml: string; autosave?: number }
  | { action: "save" }
  | { action: "export"; format: string; xml: string; spinKey?: string };

/** Messages received FROM the draw.io editor iframe (events). */
interface DrawioEvent {
  event: string;
  xml?: string;
  data?: string;
  format?: string;
}

interface UseDrawioEmbedResult {
  /** Attach to the <iframe> element in EmbedFrame. */
  iframeRef: React.RefObject<HTMLIFrameElement | null>;
  /** The current architecture mxfile XML (full, all pages). */
  drawioXml: string;
  /** True while the initial XML is being fetched. */
  loading: boolean;
  /** Error message if the initial fetch failed. */
  error: string | null;
  /** Request the editor to save; resolves with the saved XML. */
  save: () => Promise<string>;
  /** Export the current diagram as PNG; resolves with base64 data. */
  exportPng: () => Promise<string>;
  /** Load a new page's XML into the editor (used by the industry switcher). */
  loadPage: (xml: string) => void;
}

export function useDrawioEmbed(): UseDrawioEmbedResult {
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const [drawioXml, setDrawioXml] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Refs to avoid stale closures inside the message handler.
  const xmlRef = useRef("");
  const editorReadyRef = useRef(false);
  const exportResolverRef = useRef<((data: string) => void) | null>(null);
  const saveResolverRef = useRef<((xml: string) => void) | null>(null);

  /** Post a message to the draw.io editor iframe. */
  const sendToEditor = useCallback((message: DrawioAction): void => {
    iframeRef.current?.contentWindow?.postMessage(message, "*");
  }, []);

  // --- Load the architecture XML on mount --------------------------------
  useEffect(() => {
    let cancelled = false;
    api
      .getArchitecture()
      .then((res) => {
        if (cancelled) return;
        setDrawioXml(res.drawioXml);
        xmlRef.current = res.drawioXml;
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

  // --- Listen for postMessage events from the editor --------------------
  useEffect(() => {
    function handler(event: MessageEvent): void {
      // Only accept messages from our draw.io iframe.
      const iframe = iframeRef.current;
      if (!iframe || event.source !== iframe.contentWindow) return;
      const msg = event.data as DrawioEvent | null;
      if (typeof msg !== "object" || msg === null) return;

      if (msg.event === "init") {
        editorReadyRef.current = true;
        // Configure the editor, then load the current XML.
        sendToEditor({ action: "configure", config: { format: "xml" } });
        if (xmlRef.current) {
          sendToEditor({ action: "load", xml: xmlRef.current, autosave: 0 });
        }
      } else if (msg.event === "save" && typeof msg.xml === "string") {
        // The editor returned the (possibly edited) XML — persist it.
        const xml = msg.xml;
        xmlRef.current = xml;
        setDrawioXml(xml);
        api.saveArchitecture(xml).catch(() => {
          /* best-effort persistence — editor state is the source of truth */
        });
        if (saveResolverRef.current) {
          saveResolverRef.current(xml);
          saveResolverRef.current = null;
        }
      } else if (msg.event === "export" && typeof msg.data === "string") {
        if (exportResolverRef.current) {
          exportResolverRef.current(msg.data);
          exportResolverRef.current = null;
        }
      }
    }

    window.addEventListener("message", handler);
    return () => window.removeEventListener("message", handler);
  }, [sendToEditor]);

  // --- Public actions ---------------------------------------------------

  /** Load a different page's XML into the editor (industry switch). */
  const loadPage = useCallback(
    (xml: string): void => {
      xmlRef.current = xml;
      setDrawioXml(xml);
      sendToEditor({ action: "load", xml, autosave: 0 });
    },
    [sendToEditor],
  );

  /** Request the editor to save; resolves with the saved XML. */
  const save = useCallback(
    (): Promise<string> =>
      new Promise((resolve) => {
        saveResolverRef.current = resolve;
        sendToEditor({ action: "save" });
      }),
    [sendToEditor],
  );

  /** Export the current diagram as PNG; resolves with base64 data. */
  const exportPng = useCallback(
    (): Promise<string> =>
      new Promise((resolve, reject) => {
        if (!editorReadyRef.current) {
          reject(new Error("Editor is not ready yet"));
          return;
        }
        exportResolverRef.current = resolve;
        sendToEditor({
          action: "export",
          format: "png",
          xml: xmlRef.current,
          spinKey: "export",
        });
      }),
    [sendToEditor],
  );

  return { iframeRef, drawioXml, loading, error, save, exportPng, loadPage };
}
