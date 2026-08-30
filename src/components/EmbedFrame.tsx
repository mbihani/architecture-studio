// ---------------------------------------------------------------------------
// EmbedFrame — hosts the draw.io (diagrams.net) embeddable editor.
//
// The iframe src is the embed URL owned by the useDrawioEmbed hook (which may
// switch from embed.diagrams.net to www.draw.io as a fallback). Communication
// with the editor happens via window.postMessage — the hook owns that
// lifecycle and passes the iframe ref down here. This component is purely
// presentational.
// ---------------------------------------------------------------------------

interface EmbedFrameProps {
  /** Ref to the iframe element; owned by useDrawioEmbed for postMessage. */
  iframeRef: React.RefObject<HTMLIFrameElement | null>;
  /** The draw.io embed URL (may switch to www.draw.io as a fallback). */
  embedUrl: string;
  /** Fired when the iframe's src document finishes loading. */
  onIframeLoad: () => void;
  /** Fired when the iframe fails to load its src document. */
  onIframeError: () => void;
}

export function EmbedFrame({
  iframeRef,
  embedUrl,
  onIframeLoad,
  onIframeError,
}: EmbedFrameProps): React.ReactElement {
  return (
    <div className="embed-frame">
      <iframe
        ref={iframeRef}
        title="draw.io architecture editor"
        src={embedUrl}
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
