// ---------------------------------------------------------------------------
// drawio-to-svg — a self-contained, dependency-free renderer that turns a
// draw.io mxfile XML document into one SVG string per diagram page.
//
// No iframe, no network, no external libraries — only the browser's built-in
// DOMParser (and, for compressed diagrams, the built-in DecompressionStream).
// The output is plain SVG markup ready to inject into the DOM via innerHTML.
//
// What it renders:
//   • vertices (shapes) — rect, rounded rect, ellipse, cylinder (database),
//     rhombus, triangle, hexagon, double-ellipse, and swimlane containers,
//     each with fillColor / strokeColor / fontColor / fontSize / opacity /
//     rounded / dashed from the draw.io style string.
//   • edges (connectors) — straight or orthogonal (Manhattan) routing between
//     the source and target shapes, honoring exitX/exitY/entryX/entryY
//     connection points and explicit waypoints, with colored arrowheads.
//   • labels — shape and edge text, decoded from draw.io HTML labels to plain
//     (multi-line) text and laid out with the style's alignment.
//
// Coordinates: a child's geometry is relative to its parent's, so absolute
// positions are computed by walking the parent chain and summing offsets.
// The SVG viewBox is derived from the bounding box of every rendered shape
// and edge point (infinite canvas — no fixed page dimensions).
// ---------------------------------------------------------------------------

/** One rendered diagram page: its id, display name, and SVG markup. */
export interface SvgPage {
  id: string;
  name: string;
  svg: string;
}

// --- small string / numeric helpers ----------------------------------------

/** Escape text for safe inclusion in SVG text content. */
function escText(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/** Escape text for safe inclusion in an SVG attribute value. */
function escAttr(value: string): string {
  return escText(value).replace(/"/g, "&quot;");
}

/** Format a coordinate for an SVG attribute (trim trailing zeros). */
function n(value: number): string {
  return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(2)));
}

/** Coerce a style value to a finite number, falling back when missing. */
function num(value: string | null | undefined, fallback: number): number {
  if (value === undefined || value === null || value === "") return fallback;
  const v = Number(value);
  return Number.isFinite(v) ? v : fallback;
}

/** Parse a semicolon-separated draw.io style string into a key→value map. */
function parseStyle(style: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const raw of style.split(";")) {
    const part = raw.trim();
    if (!part) continue;
    const eq = part.indexOf("=");
    if (eq === -1) out[part] = "1"; // bare flag, e.g. "rounded", "html"
    else out[part.slice(0, eq).trim()] = part.slice(eq + 1).trim();
  }
  return out;
}

// --- cell model ------------------------------------------------------------

type ShapeType =
  | "rect"
  | "rounded"
  | "ellipse"
  | "cylinder"
  | "rhombus"
  | "triangle"
  | "hexagon"
  | "doubleEllipse"
  | "swimlane";

interface Cell {
  id: string;
  parent: string;
  value: string;
  styleMap: Record<string, string>;
  isVertex: boolean;
  isEdge: boolean;
  source: string;
  target: string;
  /** Raw geometry (relative to parent). */
  x: number;
  y: number;
  w: number;
  h: number;
  hasGeo: boolean;
  /** Explicit edge waypoints, in absolute graph coordinates. */
  points: { x: number; y: number }[];
}

/** Determine the visual shape from the parsed draw.io style. */
function shapeType(s: Record<string, string>): ShapeType {
  const sh = s.shape;
  if (s.swimlane === "1" || sh === "swimlane") return "swimlane";
  if (sh === "cylinder" || s.cylinder === "1") return "cylinder";
  if (sh === "doubleEllipse" || s.doubleEllipse === "1") return "doubleEllipse";
  if (sh === "ellipse" || s.ellipse === "1") return "ellipse";
  if (sh === "rhombus" || s.rhombus === "1") return "rhombus";
  if (sh === "triangle" || s.triangle === "1") return "triangle";
  if (sh === "hexagon" || s.hexagon === "1") return "hexagon";
  if (s.rounded === "1") return "rounded";
  return "rect";
}

/** Collect every <mxCell> from a <root> element into typed Cell records. */
function collectCells(root: Element): Map<string, Cell> {
  const byId = new Map<string, Cell>();
  for (const el of Array.from(root.children)) {
    if (el.tagName !== "mxCell") continue;
    const id = el.getAttribute("id") ?? "";
    if (!id) continue;
    const style = el.getAttribute("style") ?? "";
    const geo = el.querySelector("mxGeometry");
    const points: { x: number; y: number }[] = [];
    if (geo) {
      for (const pt of Array.from(geo.querySelectorAll("mxPoint"))) {
        const px = pt.getAttribute("x");
        const py = pt.getAttribute("y");
        if (px !== null && py !== null) {
          points.push({ x: Number(px), y: Number(py) });
        }
      }
    }
    const cell: Cell = {
      id,
      parent: el.getAttribute("parent") ?? "1",
      value: el.getAttribute("value") ?? "",
      styleMap: parseStyle(style),
      isVertex: el.getAttribute("vertex") === "1",
      isEdge: el.getAttribute("edge") === "1",
      source: el.getAttribute("source") ?? "",
      target: el.getAttribute("target") ?? "",
      x: num(geo?.getAttribute("x"), 0),
      y: num(geo?.getAttribute("y"), 0),
      w: num(geo?.getAttribute("width"), 0),
      h: num(geo?.getAttribute("height"), 0),
      hasGeo: geo !== null,
      points,
    };
    byId.set(id, cell);
  }
  return byId;
}

/** Absolute (graph) position of a cell, summing relative offsets up the parent chain. */
function absolutePos(cell: Cell, byId: Map<string, Cell>): { x: number; y: number } {
  let x = cell.x;
  let y = cell.y;
  let parentId = cell.parent;
  // Walk up through container vertices (the layer "1" sits at the origin).
  while (parentId && parentId !== "0" && parentId !== "1") {
    const parent = byId.get(parentId);
    if (!parent || !parent.isVertex) break;
    x += parent.x;
    y += parent.y;
    parentId = parent.parent;
  }
  return { x, y };
}

// --- label text ------------------------------------------------------------

/**
 * Extract renderable label text from a draw.io cell value. Values may be plain
 * text (the converter HTML-escapes names) or HTML (html=1, e.g. "<b>Name</b>").
 * <br> and &#xa; become newlines so multi-line labels render as separate lines.
 */
function labelText(value: string): string {
  if (!value) return "";
  const doc = new DOMParser().parseFromString(`<div>${value}</div>`, "text/html");
  for (const br of Array.from(doc.querySelectorAll("br"))) {
    br.replaceWith(doc.createTextNode("\n"));
  }
  return (doc.body.textContent ?? "").replace(/\r/g, "");
}

/** Build an SVG <text> element for a label, centered in a box. */
function renderLabel(
  text: string,
  cx: number,
  cy: number,
  w: number,
  h: number,
  style: Record<string, string>,
  isSwimlaneTitle = false,
): string {
  const label = text.trim();
  if (!label) return "";
  const fontColor = style.fontColor ?? "#172033";
  const fontSize = num(style.fontSize, 12);
  const fontStyle = num(style.fontStyle, 0);
  const align = style.align ?? "center"; // horizontal: left/center/right
  const vAlign = isSwimlaneTitle ? "top" : style.verticalAlign ?? "middle";

  // Horizontal anchor + x position.
  let anchor: string;
  let tx: number;
  if (align === "left") {
    anchor = "start";
    tx = cx - w / 2 + 6;
  } else if (align === "right") {
    anchor = "end";
    tx = cx + w / 2 - 6;
  } else {
    anchor = "middle";
    tx = cx;
  }

  const lines = label.split("\n");
  const lineHeight = fontSize * 1.2;

  // Vertical baseline so the block is centered (middle), top-, or bottom-aligned.
  let startBaseline: number;
  if (vAlign === "top") {
    startBaseline = cy - h / 2 + fontSize * 0.9;
  } else if (vAlign === "bottom") {
    startBaseline = cy + h / 2 - (lines.length - 1) * lineHeight - fontSize * 0.25;
  } else {
    startBaseline = cy - ((lines.length - 1) * lineHeight) / 2 + fontSize * 0.35;
  }

  const weight = (fontStyle & 1) !== 0 ? `font-weight="bold"` : "";
  const italic = (fontStyle & 2) !== 0 ? `font-style="italic"` : "";
  const tspans = lines
    .map((line, i) => {
      const dy = i === 0 ? "0" : `${lineHeight}px`;
      return `<tspan x="${n(tx)}" dy="${dy}">${escText(line)}</tspan>`;
    })
    .join("");

  return (
    `<text x="${n(tx)}" y="${n(startBaseline)}" text-anchor="${anchor}" ` +
    `font-family="system-ui,-apple-system,'Segoe UI',Roboto,sans-serif" ` +
    `font-size="${n(fontSize)}" fill="${escAttr(fontColor)}" ${weight} ${italic}>` +
    tspans +
    `</text>`
  );
}

// --- geometry helpers ------------------------------------------------------

/** The point where the ray from a box's center toward a target exits the box. */
function clipRect(
  cx: number,
  cy: number,
  w: number,
  h: number,
  tx: number,
  ty: number,
): { x: number; y: number } {
  const dx = tx - cx;
  const dy = ty - cy;
  if (dx === 0 && dy === 0) return { x: cx, y: cy };
  const hw = w / 2;
  const hh = h / 2;
  const sx = dx !== 0 ? Math.abs(hw / dx) : Infinity;
  const sy = dy !== 0 ? Math.abs(hh / dy) : Infinity;
  const s = Math.min(sx, sy);
  return { x: cx + dx * s, y: cy + dy * s };
}

/** An orthogonal (Manhattan) Z-route between two points with no waypoints. */
function zRoute(a: { x: number; y: number }, b: { x: number; y: number }): string {
  const dx = Math.abs(a.x - b.x);
  const dy = Math.abs(a.y - b.y);
  // Roughly aligned → a single straight segment looks cleanest.
  if (dx < 2 || dy < 2) return `M${n(a.x)},${n(a.y)} L${n(b.x)},${n(b.y)}`;
  const midX = (a.x + b.x) / 2;
  return `M${n(a.x)},${n(a.y)} L${n(midX)},${n(a.y)} L${n(midX)},${n(b.y)} L${n(b.x)},${n(b.y)}`;
}

/** A filled or open arrowhead polygon at `tip`, pointing along prev→tip. */
function arrowHead(
  prev: { x: number; y: number },
  tip: { x: number; y: number },
  color: string,
  open: boolean,
): string {
  const ang = Math.atan2(tip.y - prev.y, tip.x - prev.x);
  const len = 9;
  const halfW = 5;
  const bx = tip.x - len * Math.cos(ang);
  const by = tip.y - len * Math.sin(ang);
  const left = { x: bx + halfW * Math.cos(ang + Math.PI / 2), y: by + halfW * Math.sin(ang + Math.PI / 2) };
  const right = { x: bx + halfW * Math.cos(ang - Math.PI / 2), y: by + halfW * Math.sin(ang - Math.PI / 2) };
  if (open) {
    return (
      `<path d="M${n(tip.x)},${n(tip.y)} L${n(left.x)},${n(left.y)} ` +
      `M${n(tip.x)},${n(tip.y)} L${n(right.x)},${n(right.y)}" ` +
      `fill="none" stroke="${escAttr(color)}" stroke-linecap="round" />`
    );
  }
  return (
    `<polygon points="${n(tip.x)},${n(tip.y)} ${n(left.x)},${n(left.y)} ${n(right.x)},${n(right.y)}" ` +
    `fill="${escAttr(color)}" />`
  );
}

// --- edge rendering --------------------------------------------------------

function renderEdge(
  edge: Cell,
  byId: Map<string, Cell>,
  abs: Map<string, { x: number; y: number }>,
): { svg: string; points: { x: number; y: number }[] } {
  const src = byId.get(edge.source);
  const tgt = byId.get(edge.target);
  if (!src || !tgt || !src.hasGeo || !tgt.hasGeo) return { svg: "", points: [] };
  const s = edge.styleMap;
  const color = s.strokeColor ?? "#6B7280";
  const width = num(s.strokeWidth, 1.5);
  const dashed = s.dashed === "1";
  const opacity = num(s.opacity, 1);
  const orthogonal = /orthogonal|elbow/.test(s.edgeStyle ?? "");

  const sAbs = abs.get(src.id)!;
  const tAbs = abs.get(tgt.id)!;
  const sCx = sAbs.x + src.w / 2;
  const sCy = sAbs.y + src.h / 2;
  const tCx = tAbs.x + tgt.w / 2;
  const tCy = tAbs.y + tgt.h / 2;

  // Source connection point: explicit exit point, else the border toward target.
  let sp: { x: number; y: number };
  if (s.exitX !== undefined || s.exitY !== undefined) {
    sp = { x: sAbs.x + num(s.exitX, 0.5) * src.w, y: sAbs.y + num(s.exitY, 0.5) * src.h };
  } else {
    sp = clipRect(sCx, sCy, src.w, src.h, tCx, tCy);
  }
  // Target connection point: explicit entry point, else the border toward source.
  let tp: { x: number; y: number };
  if (s.entryX !== undefined || s.entryY !== undefined) {
    tp = { x: tAbs.x + num(s.entryX, 0.5) * tgt.w, y: tAbs.y + num(s.entryY, 0.5) * tgt.h };
  } else {
    tp = clipRect(tCx, tCy, tgt.w, tgt.h, sCx, sCy);
  }

  // Full point list: source → waypoints → target.
  const pts = [sp, ...edge.points, tp];

  let d: string;
  if (orthogonal && edge.points.length === 0) {
    d = zRoute(sp, tp);
  } else {
    d = pts.map((p, i) => `${i === 0 ? "M" : "L"}${n(p.x)},${n(p.y)}`).join(" ");
  }

  let svg =
    `<path d="${d}" fill="none" stroke="${escAttr(color)}" stroke-width="${n(width)}" ` +
    `stroke-linejoin="round" stroke-linecap="round" opacity="${n(opacity)}"`;
  if (dashed) svg += ` stroke-dasharray="6 4"`;
  svg += ` />`;

  // Arrowheads.
  const endArrow = s.endArrow ?? "classic";
  if (endArrow !== "none") {
    const open = endArrow === "open" || endArrow === "oval";
    svg += arrowHead(pts[pts.length - 2] ?? sp, tp, color, open);
  }
  const startArrow = s.startArrow ?? "none";
  if (startArrow !== "none") {
    const open = startArrow === "open" || startArrow === "oval";
    svg += arrowHead(pts[1] ?? tp, sp, color, open);
  }

  // Edge label at the path midpoint.
  const label = labelText(edge.value);
  if (label) {
    const mid = pts[Math.floor(pts.length / 2)];
    svg += renderLabel(label, mid.x, mid.y, 0, 0, {
      ...s,
      fontSize: s.fontSize ?? "11",
      fontColor: s.fontColor ?? "#374151",
    });
  }

  return { svg, points: pts };
}

// --- shape rendering -------------------------------------------------------

function renderShape(
  cell: Cell,
  pos: { x: number; y: number },
): { geometry: string; label: string } {
  const s = cell.styleMap;
  const x = pos.x;
  const y = pos.y;
  const w = cell.w;
  const h = cell.h;
  const fill = s.fillColor && s.fillColor !== "none" ? s.fillColor : "none";
  const stroke = s.strokeColor ?? "#6B7280";
  const sw = num(s.strokeWidth, 1);
  const opacity = num(s.opacity, 1);
  const dashed = s.dashed === "1";
  const type = shapeType(s);

  const strokeAttr = stroke === "none" ? `` : `stroke="${escAttr(stroke)}"`;
  const fillAttr = fill === "none" ? `fill="none"` : `fill="${escAttr(fill)}"`;
  const common = `${fillAttr} ${strokeAttr} stroke-width="${n(sw)}" opacity="${n(opacity)}"`;
  const dashAttr = dashed ? ` stroke-dasharray="6 4"` : "";

  let geometry = "";
  const cx = x + w / 2;
  const cy = y + h / 2;

  switch (type) {
    case "ellipse":
      geometry = `<ellipse cx="${n(cx)}" cy="${n(cy)}" rx="${n(w / 2)}" ry="${n(h / 2)}" ${common}${dashAttr} />`;
      break;
    case "doubleEllipse": {
      geometry = `<ellipse cx="${n(cx)}" cy="${n(cy)}" rx="${n(w / 2)}" ry="${n(h / 2)}" ${common}${dashAttr} />`;
      const inset = Math.min(6, w / 8, h / 8);
      geometry += `<ellipse cx="${n(cx)}" cy="${n(cy)}" rx="${n(w / 2 - inset)}" ry="${n(h / 2 - inset)}" ${common}${dashAttr} />`;
      break;
    }
    case "cylinder": {
      const ry = Math.max(6, Math.min(h * 0.15, 14));
      const rx = w / 2;
      // Top rim (full ellipse) + body sides + bottom front arc.
      geometry =
        `<ellipse cx="${n(cx)}" cy="${n(y + ry)}" rx="${n(rx)}" ry="${n(ry)}" ${common}${dashAttr} />` +
        `<path d="M${n(x)},${n(y + ry)} L${n(x)},${n(y + h - ry)} ` +
        `A${n(rx)},${n(ry)} 0 0 0 ${n(x + w)},${n(y + h - ry)} L${n(x + w)},${n(y + ry)}" ` +
        `${common}${dashAttr} />`;
      break;
    }
    case "rhombus":
      geometry =
        `<polygon points="${n(cx)},${n(y)} ${n(x + w)},${n(cy)} ${n(cx)},${n(y + h)} ${n(x)},${n(cy)}" ` +
        `${common}${dashAttr} />`;
      break;
    case "triangle":
      geometry =
        `<polygon points="${n(cx)},${n(y)} ${n(x + w)},${n(y + h)} ${n(x)},${n(y + h)}" ` +
        `${common}${dashAttr} />`;
      break;
    case "hexagon": {
      const sz = Math.min(w * 0.25, 18);
      geometry =
        `<polygon points="${n(x + sz)},${n(y)} ${n(x + w - sz)},${n(y)} ${n(x + w)},${n(cy)} ` +
        `${n(x + w - sz)},${n(y + h)} ${n(x + sz)},${n(y + h)} ${n(x)},${n(cy)}" ` +
        `${common}${dashAttr} />`;
      break;
    }
    case "swimlane": {
      // A titled container: a body rect with a shaded title strip at the top.
      const startSize = num(s.startSize, 30);
      const bodyFill = s.swimlaneFillColor && s.swimlaneFillColor !== "none" ? s.swimlaneFillColor : "#FFFFFF";
      const titleFill = fill === "none" ? "#E5E7EB" : fill;
      geometry =
        `<rect x="${n(x)}" y="${n(y)}" width="${n(w)}" height="${n(h)}" ` +
        `fill="${escAttr(bodyFill)}" ${strokeAttr} stroke-width="${n(sw)}" opacity="${n(opacity)}"${dashAttr} />` +
        `<rect x="${n(x)}" y="${n(y)}" width="${n(w)}" height="${n(startSize)}" ` +
        `fill="${escAttr(titleFill)}" ${strokeAttr} stroke-width="${n(sw)}" opacity="${n(opacity)}"${dashAttr} />`;
      const label = renderLabel(cell.value, cx, y + startSize / 2, w, startSize, s, true);
      return { geometry, label };
    }
    case "rounded":
    case "rect":
    default: {
      const rx = type === "rounded" ? Math.min(w, h) * (num(s.arcSize, 10) / 100) : 0;
      geometry = `<rect x="${n(x)}" y="${n(y)}" width="${n(w)}" height="${n(h)}"`;
      if (rx > 0) geometry += ` rx="${n(rx)}" ry="${n(rx)}"`;
      geometry += ` ${common}${dashAttr} />`;
      break;
    }
  }

  const label = renderLabel(cell.value, cx, cy, w, h, s);
  return { geometry, label };
}

// --- compression -----------------------------------------------------------

/**
 * Decode a diagram body to an <mxGraphModel> element. Uncompressed diagrams
 * contain the model inline; compressed diagrams store a base64 + raw-deflate
 * payload as text content. Decompression uses the browser's built-in
 * DecompressionStream (no external dependency); if it is unavailable the
 * diagram falls back to an empty model rather than crashing.
 */
async function decodeModel(diagram: Element): Promise<Element | null> {
  const inline = diagram.querySelector("mxGraphModel");
  if (inline) return inline;

  const payload = (diagram.textContent ?? "").trim();
  if (!payload) return null;

  try {
    const Ctor = (globalThis as { DecompressionStream?: unknown }).DecompressionStream;
    if (typeof Ctor !== "function") return null;
    const binary = atob(payload);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    const stream = new Blob([bytes]).stream().pipeThrough(
      new (Ctor as new (format: string) => TransformStream)("deflate-raw"),
    );
    const xml = await new Response(stream).text();
    const doc = new DOMParser().parseFromString(xml, "application/xml");
    return doc.querySelector("mxGraphModel") ?? doc.documentElement;
  } catch {
    return null;
  }
}

// --- main entry point ------------------------------------------------------

/** Default viewBox when a diagram has no shapes (a small blank canvas). */
const EMPTY_VIEWBOX = "0 0 200 120";

/**
 * Convert a draw.io mxfile XML string into one rendered SVG page per diagram.
 * Returns pages in document order, each with its id, name, and SVG markup.
 */
export async function drawioToSvg(xml: string): Promise<SvgPage[]> {
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  const mxfile = doc.documentElement.tagName === "mxfile" ? doc.documentElement : doc.querySelector("mxfile");
  if (!mxfile) return [];

  const diagrams = Array.from(mxfile.querySelectorAll("diagram"));
  const pages: SvgPage[] = [];

  for (const diagram of diagrams) {
    const id = diagram.getAttribute("id") ?? `page-${pages.length}`;
    const name = diagram.getAttribute("name") ?? id;
    const model = await decodeModel(diagram);
    const svg = model ? renderModel(model) : emptySvg();
    pages.push({ id, name, svg });
  }

  return pages;
}

/** Render a single <mxGraphModel> element to an SVG string. */
function renderModel(model: Element): string {
  const root = model.querySelector("root");
  if (!root) return emptySvg();

  const byId = collectCells(root);

  // Absolute positions for every cell with geometry.
  const abs = new Map<string, { x: number; y: number }>();
  for (const cell of byId.values()) {
    if (cell.hasGeo) abs.set(cell.id, absolutePos(cell, byId));
  }

  let edgeSvg = "";
  let shapeSvg = "";
  let labelSvg = "";
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  const expand = (x: number, y: number, w = 0, h = 0): void => {
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x + w);
    maxY = Math.max(maxY, y + h);
  };

  // Edges first (drawn beneath shapes), shapes next, all labels last (on top).
  for (const cell of byId.values()) {
    if (cell.isEdge) {
      const { svg, points } = renderEdge(cell, byId, abs);
      if (!svg) continue;
      edgeSvg += svg;
      for (const p of points) expand(p.x, p.y);
    }
  }

  for (const cell of byId.values()) {
    if (cell.isVertex && cell.hasGeo && cell.id !== "0" && cell.id !== "1") {
      const pos = abs.get(cell.id)!;
      const { geometry, label } = renderShape(cell, pos);
      shapeSvg += geometry;
      labelSvg += label;
      expand(pos.x, pos.y, cell.w, cell.h);
    }
  }

  const hasContent = Number.isFinite(minX);
  const pad = 24;
  const vb = hasContent
    ? `${n(minX - pad)} ${n(minY - pad)} ${n(maxX - minX + 2 * pad)} ${n(maxY - minY + 2 * pad)}`
    : EMPTY_VIEWBOX;

  const defs =
    `<defs>` +
    `<filter id="ds" x="-10%" y="-10%" width="120%" height="120%">` +
    `<feDropShadow dx="0" dy="1.5" stdDeviation="2" flood-color="#1e293b" flood-opacity="0.18" />` +
    `</filter>` +
    `</defs>`;

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vb}" ` +
    `preserveAspectRatio="xMidYMid meet" width="100%" height="100%">` +
    defs +
    `<g class="d-edges">${edgeSvg}</g>` +
    `<g class="d-shapes" filter="url(#ds)">${shapeSvg}</g>` +
    `<g class="d-labels">${labelSvg}</g>` +
    `</svg>`
  );
}

/** A blank SVG for empty / undecodable diagrams. */
function emptySvg(): string {
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${EMPTY_VIEWBOX}" ` +
    `preserveAspectRatio="xMidYMid meet" width="100%" height="100%"></svg>`
  );
}
