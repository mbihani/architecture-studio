// ---------------------------------------------------------------------------
// SvgViewer — displays an SVG string with mouse-wheel zoom and click-drag
// panning.
//
// The SVG markup (from drawio-to-svg) is injected via dangerouslySetInnerHTML
// into a viewport div that is transformed (translate + scale) for pan/zoom.
// The SVG itself carries a viewBox computed from the diagram's bounding box,
// so at zoom 1 / pan 0 the whole diagram fits the container (letterboxed).
//
// Controls: wheel to zoom (centered on the cursor), drag to pan, plus a
// zoom-to-fit button and +/− buttons in the top-right corner.
// ---------------------------------------------------------------------------

import { useCallback, useEffect, useRef, useState } from "react";

interface SvgViewerProps {
  /** Pre-rendered SVG markup for the page to display. */
  svg: string;
}

const MIN_ZOOM = 0.15;
const MAX_ZOOM = 8;

interface View {
  zoom: number;
  x: number;
  y: number;
}

const FIT: View = { zoom: 1, x: 0, y: 0 };

function clampZoom(z: number): number {
  return Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, z));
}

export function SvgViewer({ svg }: SvgViewerProps): React.ReactElement {
  const containerRef = useRef<HTMLDivElement>(null);
  const [view, setView] = useState<View>(FIT);
  const dragging = useRef(false);
  const last = useRef({ x: 0, y: 0 });

  // Reset the view whenever the displayed page changes.
  useEffect(() => {
    setView(FIT);
  }, [svg]);

  /** Zoom by a factor, keeping the given container-space point fixed. */
  const zoomAt = useCallback((cx: number, cy: number, factor: number): void => {
    setView((v) => {
      const next = clampZoom(v.zoom * factor);
      if (next === v.zoom) return v;
      const ratio = next / v.zoom;
      return {
        zoom: next,
        x: cx - ratio * (cx - v.x),
        y: cy - ratio * (cy - v.y),
      };
    });
  }, []);

  // Non-passive wheel listener so we can preventDefault (avoid page scroll).
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent): void => {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const cx = e.clientX - rect.left;
      const cy = e.clientY - rect.top;
      const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
      zoomAt(cx, cy, factor);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [zoomAt]);

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>): void => {
    dragging.current = true;
    last.current = { x: e.clientX, y: e.clientY };
    (e.currentTarget as HTMLDivElement).setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>): void => {
    if (!dragging.current) return;
    const dx = e.clientX - last.current.x;
    const dy = e.clientY - last.current.y;
    last.current = { x: e.clientX, y: e.clientY };
    setView((v) => ({ ...v, x: v.x + dx, y: v.y + dy }));
  };

  const onPointerUp = (e: React.PointerEvent<HTMLDivElement>): void => {
    dragging.current = false;
    (e.currentTarget as HTMLDivElement).releasePointerCapture(e.pointerId);
  };

  const zoomByButton = (factor: number): void => {
    const el = containerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    zoomAt(rect.width / 2, rect.height / 2, factor);
  };

  const zoomPercent = Math.round(view.zoom * 100);

  return (
    <div
      ref={containerRef}
      className="svg-viewer"
      style={{ cursor: dragging.current ? "grabbing" : "grab" }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerLeave={onPointerUp}
    >
      <div
        className="svg-viewer__viewport"
        style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.zoom})` }}
        dangerouslySetInnerHTML={{ __html: svg }}
      />

      <div className="svg-viewer__controls">
        <button
          type="button"
          className="svg-viewer__btn"
          onClick={() => zoomByButton(1.2)}
          title="Zoom in"
        >
          +
        </button>
        <button
          type="button"
          className="svg-viewer__btn"
          onClick={() => zoomByButton(1 / 1.2)}
          title="Zoom out"
        >
          −
        </button>
        <button
          type="button"
          className="svg-viewer__btn svg-viewer__btn--fit"
          onClick={() => setView(FIT)}
          title="Zoom to fit"
        >
          Fit
        </button>
        <span className="svg-viewer__zoom">{zoomPercent}%</span>
      </div>
    </div>
  );
}

export default SvgViewer;
