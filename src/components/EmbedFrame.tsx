// ---------------------------------------------------------------------------
// EmbedFrame — hosts the draw.io (diagrams.net) embeddable editor.
//
// The iframe is pointed at the draw.io embed URL (see DRAWIO_EMBED_URL, which
// includes &zoom=Fit so large diagrams auto-fit the viewport). Communication
// with the editor happens via window.postMessage — the useDrawioEmbed hook
// owns that lifecycle and passes the iframe ref down here. This component is
// purely presentational.
// ---------------------------------------------------------------------------

import { DRAWIO_EMBED_URL } from "../hooks/useDrawioEmbed.ts";

interface EmbedFrameProps {
  /** Ref to the iframe element; owned by useDrawioEmbed for postMessage. */
  iframeRef: React.RefObject<HTMLIFrameElement | null>;
}

export function EmbedFrame({ iframeRef }: EmbedFrameProps): React.ReactElement {
  return (
    <div className="embed-frame">
      <iframe
        ref={iframeRef}
        title="draw.io architecture editor"
        src={DRAWIO_EMBED_URL}
        className="embed-frame__iframe"
        allow="fullscreen"
        allowFullScreen
      />
    </div>
  );
}

export default EmbedFrame;
