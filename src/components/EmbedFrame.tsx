// ---------------------------------------------------------------------------
// EmbedFrame — hosts the draw.io (diagrams.net) embeddable editor.
//
// The iframe is pointed at the draw.io embed URL (see DRAWIO_EMBED_URL).
// Communication with the editor happens via window.postMessage — the
// useDrawioEmbed hook owns that lifecycle and passes the iframe ref down
// here. This component is purely presentational.
// ---------------------------------------------------------------------------

import { DRAWIO_EMBED_URL } from "../hooks/useDrawioEmbed.ts";

interface EmbedFrameProps {
  /** Ref to the iframe element; owned by useDrawioEmbed for postMessage. */
  iframeRef: React.RefObject<HTMLIFrameElement | null>;
  /** Fired when the iframe's src document finishes loading. */
  onIframeLoad: () => void;
  /** Fired when the iframe fails to load its src document. */
  onIframeError: () => void;
}

export function EmbedFrame({
  iframeRef,
  onIframeLoad,
  onIframeError,
}: EmbedFrameProps): React.ReactElement {
  return (
    <div className="embed-frame">
      <iframe
        ref={iframeRef}
        title="draw.io architecture editor"
        src={DRAWIO_EMBED_URL}
        className="embed-frame__iframe"
        allow="fullscreen"
        allowFullScreen
        onLoad={onIframeLoad}
        onError={onIframeError}
      />
    </div>
  );
}

export default EmbedFrame;
