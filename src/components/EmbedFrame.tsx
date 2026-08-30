// ---------------------------------------------------------------------------
// EmbedFrame — renders the editable Lucidchart canvas.
//
// Lucid's token-based Embed API loads an editable document inside an iframe
// pointed at https://lucid.app/embeds?token=...&mode=editor. The backend
// generates a short-lived token (POST /api/embed/session) and hands back the
// full URL; this component simply hosts the iframe.
// ---------------------------------------------------------------------------

interface EmbedFrameProps {
  /** Full embed URL returned by POST /api/embed/session. */
  url: string;
}

export function EmbedFrame({ url }: EmbedFrameProps): React.ReactElement {
  return (
    <div className="embed-frame">
      <iframe
        title="Lucidchart architecture editor"
        src={url}
        className="embed-frame__iframe"
        allow="fullscreen"
        // Lucid's embed expects to be allowed full size and to run scripts.
        allowFullScreen
      />
    </div>
  );
}

export default EmbedFrame;
