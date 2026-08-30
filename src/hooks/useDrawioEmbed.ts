// ---------------------------------------------------------------------------
// useDrawioEmbed — owns the draw.io (diagrams.net) embed lifecycle.
//
// The hook loads the FULL architecture mxfile XML (all pages as tabs) from
// GET /api/architecture on mount, renders the editor iframe (via the returned
// ref), and drives the postMessage protocol:
//
//   init       → configure + load the full mxfile into the editor (all pages)
//   save       → persist the full mxfile via POST /api/architecture
//   export     → resolve a promise with a PNG data URI
//   switchPage → reorder the mxfile so the selected page is the visible tab,
//                then reload the full document (all pages preserved)
//
// Industry switching NEVER replaces the editor with a single page — the full
// mxfile stays loaded so a save always persists every page. draw.io's embed
// protocol has no "switch page" action, so switching reorders the <diagram>
// elements (selected page first) and reloads, which makes that tab active.
//
// No OAuth, no polling — all communication is event-driven postMessage, and
// every message is origin-checked against the embed host.
// ---------------------------------------------------------------------------

import { useCallback, useEffect, useRef, useState } from "react";

import { api, type ApiError } from "../api/client.ts";

/** The embed URL for the diagrams.net editor (no API key, no OAuth). */
export const DRAWIO_EMBED_URL =
  "https://embed.diagrams.net?proto=json&svg=1&splash=0";

/** Origin of the embedded draw.io editor — used as the postMessage target. */
const DRAWIO_ORIGIN = "https://embed.diagrams.net";
/**
 * Origins we accept postMessage events from. We embed embed.diagrams.net, but
 * some deployments redirect to www.draw.io, so accept both defensively.
 */
const ALLOWED_ORIGINS = new Set([
  "https://embed.diagrams.net",
  "https://www.draw.io",
]);

/** Messages sent TO the draw.io editor iframe (actions). */
type DrawioAction =
  | { action: "configure"; config: Record<string, unknown> }
  | { action: "load"; xml: string; autosave?: number; fit?: number }
  | { action: "save" }
  | { action: "export"; format: string; spinKey?: string };

/** Messages received FROM the draw.io editor iframe (events). */
interface DrawioEvent {
  event: string;
  xml?: string;
  data?: string;
  format?: string;
}

/**
 * Coarse lifecycle of the draw.io embed, surfaced for the diagnostic overlay.
 * Progresses: fetching → iframe-loading → (init-waiting | loading-xml) →
 * loaded, or → error.
 */
export type DrawioStatus =
  | "fetching"
  | "iframe-loading"
  | "init-waiting"
  | "loading-xml"
  | "loaded"
  | "error";

interface UseDrawioEmbedResult {
  /** Attach to the <iframe> element in EmbedFrame. */
  iframeRef: React.RefObject<HTMLIFrameElement | null>;
  /** The current architecture mxfile XML (full, all pages). */
  drawioXml: string;
  /** True while the initial XML is being fetched. */
  loading: boolean;
  /** Error message if the initial fetch failed. */
  error: string | null;
  /** Coarse embed lifecycle state for the diagnostic overlay. */
  status: DrawioStatus;
  /** Called when the editor iframe finishes loading its src document. */
  onIframeLoad: () => void;
  /** Request the editor to save; resolves with the saved XML. */
  save: () => Promise<string>;
  /** Export the current diagram as PNG; resolves with a PNG data URI. */
  exportPng: () => Promise<string>;
  /** Switch the visible editor page to the selected industry (preserves all pages). */
  switchPage: (id: string) => void;
}

/** Escape a string for safe interpolation into a RegExp. */
function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Reorder an mxfile's <diagram> elements so the diagram with the given id
 * becomes the first (visible) page. Returns the reordered XML, or null when
 * no diagram with that id exists. Works on compressed or uncompressed mxfiles
 * — only the <diagram>…</diagram> block boundaries are moved, so base64
 * diagram bodies are preserved untouched.
 */
function reorderDiagramFirst(xml: string, id: string): string | null {
  const blockRe = new RegExp(
    `(<diagram\\s+id="${escapeRegExp(id)}"[^>]*>[\\s\\S]*?</diagram>)`,
  );
  const match = xml.match(blockRe);
  if (!match) return null;
  const block = match[1];
  const without = xml.replace(blockRe, "");
  // Function replacement so `$` in the diagram body is treated literally.
  return without.replace(/(<mxfile[^>]*>)/, (openTag) => `${openTag}\n  ${block}`);
}

/**
 * Disable the page view on every <mxGraphModel> in the mxfile so the canvas is
 * infinite and all shapes are visible regardless of page dimensions. draw.io
 * defaults to a finite page (page="1", or the attribute absent), which on a
 * very large diagram leaves most shapes off-screen after a load — the editor
 * opens centered on an empty page corner. Setting page="0" removes the page
 * boundary entirely, so combined with the `&zoom=Fit` embed parameter the whole
 * diagram fits the viewport. Idempotent: a model already at page="0" is left
 * untouched, and one missing the attribute gains page="0".
 */
function setInfiniteCanvas(xml: string): string {
  return xml.replace(/<mxGraphModel\b[^>]*>/g, (tag) => {
    if (/\spage="1"/.test(tag)) return tag.replace(/\spage="1"/, ' page="0"');
    if (/\spage="[^"]*"/.test(tag)) return tag; // already non-1 (e.g. page="0")
    return tag.replace(/>$/, ' page="0">'); // no page attr → force infinite canvas
  });
}

export function useDrawioEmbed(): UseDrawioEmbedResult {
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const [drawioXml, setDrawioXml] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<DrawioStatus>("fetching");

  // Refs to avoid stale closures inside the message handler.
  const xmlRef = useRef("");
  const editorReadyRef = useRef(false);
  const exportResolverRef = useRef<((data: string) => void) | null>(null);
  const saveResolverRef = useRef<((xml: string) => void) | null>(null);
  // When set, the next editor "save" event triggers a page switch: the saved
  // (full) mxfile is reordered so this diagram id is the visible tab, then
  // reloaded — preserving every page and any unsaved edits.
  const pendingSwitchRef = useRef<string | null>(null);

  /** Post a message to the draw.io editor iframe (origin-restricted). */
  const sendToEditor = useCallback((message: DrawioAction): void => {
    iframeRef.current?.contentWindow?.postMessage(message, DRAWIO_ORIGIN);
  }, []);

  /**
   * Load the full mxfile XML into the editor and fit the diagram to the
   * viewport so every shape is visible. Before sending, the XML is rewritten
   * to disable the page view on every <mxGraphModel> (see setInfiniteCanvas),
   * making the canvas infinite so no shapes sit off-page. The `fit` is sent
   * as a property on the load action itself, which draw.io applies once the
   * load completes — guaranteeing the fit happens after rendering (a separate
   * fit message would race the load). Shared by both sides of the init/API
   * race (see below): whichever arrives second drives the load, so the XML is
   * always rendered regardless of ordering.
   */
  const loadXml = useCallback(
    (xml: string): void => {
      setStatus("loading-xml");
      const infiniteXml = setInfiniteCanvas(xml);
      sendToEditor({ action: "load", xml: infiniteXml, autosave: 0, fit: 1 });
      setStatus("loaded");
    },
    [sendToEditor],
  );

  // --- Load the architecture XML on mount --------------------------------
  // The iframe `init` event and this fetch race: the CDN iframe usually
  // fires `init` before the (auth-gated) API returns. The init handler loads
  // the XML when it already has it; this effect loads it when the editor is
  // already waiting. Whichever arrives second drives the load.
  useEffect(() => {
    let cancelled = false;
    api
      .getArchitecture()
      .then((res) => {
        if (cancelled) return;
        setDrawioXml(res.drawioXml);
        xmlRef.current = res.drawioXml;
        // init fired first → the init handler had no XML to load. Load it now.
        if (editorReadyRef.current) {
          loadXml(res.drawioXml);
        } else {
          // Editor still initializing → wait for the init event to drive the load.
          setStatus("init-waiting");
        }
      })
      .catch((err: ApiError) => {
        if (!cancelled) {
          setError(err.message);
          setStatus("error");
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [loadXml]);

  // --- Listen for postMessage events from the editor --------------------
  useEffect(() => {
    function handler(event: MessageEvent): void {
      // Diagnostic: log EVERY postMessage event before the origin/source
      // filter. When the `init` event never arrives, this shows whether
      // draw.io is sending anything at all, and from which origin — the
      // existing filter would otherwise silently drop those messages.
      const raw = event.data;
      const eventName =
        typeof raw === "object" &&
        raw !== null &&
        typeof (raw as DrawioEvent).event === "string"
          ? (raw as DrawioEvent).event
          : "(non-drawio)";
      const iframe = iframeRef.current;
      const sourceOk = !!iframe && event.source === iframe.contentWindow;
      const originOk = ALLOWED_ORIGINS.has(event.origin);
      console.log(
        `[drawio] postMessage origin=${event.origin} event=${eventName} ` +
          `sourceCheck=${sourceOk} originCheck=${originOk}`,
      );

      // Only accept messages from our draw.io iframe, and only from the
      // embed origin (defends against any other frame posting to us).
      if (!sourceOk) return;
      if (!originOk) return;
      const msg = raw as DrawioEvent | null;
      if (typeof msg !== "object" || msg === null) return;

      if (msg.event === "init") {
        editorReadyRef.current = true;
        // Configure the editor, then load the full mxfile (all pages as tabs).
        sendToEditor({ action: "configure", config: { format: "xml" } });
        // API responded first → XML is already here; load it now. Otherwise the
        // fetch effect above loads it once it arrives (whichever is second wins).
        if (xmlRef.current) {
          loadXml(xmlRef.current);
        }
      } else if (msg.event === "save" && typeof msg.xml === "string") {
        // The editor returned the (possibly edited) full mxfile — persist it.
        const xml = msg.xml;
        xmlRef.current = xml;
        setDrawioXml(xml);
        api.saveArchitecture(xml).catch(() => {
          /* best-effort persistence — editor state is the source of truth */
        });

        // A page switch is pending: reorder so the selected page is the
        // visible tab, then reload the full document (all pages preserved).
        const pendingId = pendingSwitchRef.current;
        if (pendingId) {
          pendingSwitchRef.current = null;
          const reordered = reorderDiagramFirst(xml, pendingId);
          if (reordered) {
            xmlRef.current = reordered;
            setDrawioXml(reordered);
            // Reload through loadXml so the switched page also gets the
            // infinite-canvas rewrite + fit (consistent with the initial load).
            loadXml(reordered);
          }
        }

        if (saveResolverRef.current) {
          saveResolverRef.current(xml);
          saveResolverRef.current = null;
        }
      } else if (msg.event === "export" && typeof msg.data === "string") {
        // draw.io returns a ready-to-use PNG data URI (data:image/png;base64,…).
        if (exportResolverRef.current) {
          exportResolverRef.current(msg.data);
          exportResolverRef.current = null;
        }
      }
    }

    window.addEventListener("message", handler);
    return () => window.removeEventListener("message", handler);
  }, [sendToEditor, loadXml]);

  // --- Init timeout ----------------------------------------------------
  // If the editor never fires its `init` event — e.g. embed.diagrams.net is
  // unreachable, or the embed URL is malformed enough to break its JS — the
  // overlay would otherwise hang on "Editor initializing…" forever. Surface
  // a clear error after 20s instead. A pre-existing error (e.g. a failed
  // fetch) is preserved rather than overwritten with this generic message.
  useEffect(() => {
    const timer = setTimeout(() => {
      if (editorReadyRef.current) return;
      setStatus("error");
      setError((prev) =>
        prev
          ? prev
          : "draw.io editor failed to initialize within 20 seconds. " +
            "Check your network connection to embed.diagrams.net.",
      );
    }, 20000);
    return () => clearTimeout(timer);
  }, []);

  // --- Public actions ---------------------------------------------------

  /** Request the editor to save; resolves with the saved XML. */
  const save = useCallback(
    (): Promise<string> =>
      new Promise((resolve) => {
        saveResolverRef.current = resolve;
        sendToEditor({ action: "save" });
      }),
    [sendToEditor],
  );

  /** Export the current diagram as PNG; resolves with a PNG data URI. */
  const exportPng = useCallback(
    (): Promise<string> =>
      new Promise((resolve, reject) => {
        if (!editorReadyRef.current) {
          reject(new Error("Editor is not ready yet"));
          return;
        }
        exportResolverRef.current = resolve;
        // No `xml` field: draw.io exports the CURRENT editor content, not a
        // (possibly stale) snapshot. The returned `data` is a data URI.
        sendToEditor({ action: "export", format: "png", spinKey: "export" });
      }),
    [sendToEditor],
  );

  /**
   * Switch the visible editor page to the selected industry without dropping
   * any pages. Requests a save first so unsaved edits are captured, then (in
   * the save handler) reorders the full mxfile so the selected page is the
   * active tab and reloads it.
   */
  const switchPage = useCallback(
    (id: string): void => {
      if (!editorReadyRef.current) return;
      pendingSwitchRef.current = id;
      sendToEditor({ action: "save" });
    },
    [sendToEditor],
  );

  /**
   * Called by EmbedFrame when the iframe's src document finishes loading. We
   * move to the "iframe-loading" state (the embed HTML is ready; now we wait
   * for draw.io's `init` postMessage). Guarded so it never regresses a
   * terminal state: if `init` already fired (editorReady) the editor is past
   * this point, and an existing error is preserved.
   */
  const onIframeLoad = useCallback((): void => {
    if (editorReadyRef.current) return;
    setStatus((prev) => (prev === "error" ? prev : "iframe-loading"));
  }, []);

  return {
    iframeRef,
    drawioXml,
    loading,
    error,
    status,
    onIframeLoad,
    save,
    exportPng,
    switchPage,
  };
}
