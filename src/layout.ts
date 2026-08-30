import dagre from "dagre";
import type { ArchComponent, ArchEdge } from "./types";

// Node geometry used both for dagre sizing and for the manual grid.
const NODE_WIDTH = 196;
const NODE_HEIGHT = 64;
const COL_SPACING = 300; // horizontal distance between zone columns
const ROW_SPACING = 84; // vertical distance between stacked nodes
const BAND_GAP = 170; // gap that separates the top / cloud bands from the main flow

// Horizontal flow columns, left → right. "platform" sits in the centre.
// `top` shares the platform column but is lifted into a band above it;
// `cloud` is laid out as a horizontal band across the bottom.
const COLUMN_INDEX: Record<string, number> = {
  src: 0,
  ing: 1,
  platform: 2,
  cons: 3,
  ppl: 4,
};

export interface Position {
  x: number;
  y: number;
}

export interface PositionedNode {
  id: string;
  position: Position;
}

/**
 * Compute initial node positions for the graph.
 *
 * dagre is run on the real edges (rankdir = LR) to obtain a crossing-aware
 * vertical ordering. We then honour the requested 2D zone arrangement by
 * assigning each zone a column x and stacking its nodes top-to-bottom in the
 * dagre-derived order, which keeps the layout grouped by zone with minimal
 * edge crossings while guaranteeing no node overlaps.
 */
export function computeLayout(
  components: ArchComponent[],
  edges: ArchEdge[],
): PositionedNode[] {
  // 1. Run dagre over the real graph purely to get a good vertical ordering.
  const g = new dagre.graphlib.Graph();
  g.setGraph({ rankdir: "LR", ranksep: 240, nodesep: 28, marginx: 0, marginy: 0 });
  g.setDefaultEdgeLabel(() => ({}));

  const known = new Set(components.map((c) => c.id));
  components.forEach((c) => g.setNode(c.id, { width: NODE_WIDTH, height: NODE_HEIGHT }));
  edges.forEach((e) => {
    if (known.has(e.sourceId) && known.has(e.targetId)) {
      g.setEdge(e.sourceId, e.targetId, { weight: 1 });
    }
  });
  dagre.layout(g);

  const dagreY = (id: string): number => g.node(id)?.y ?? 0;

  // 2. Group components by zone, each group sorted by dagre's y so the
  //    within-column order reduces edge crossings.
  const byZone: Record<string, ArchComponent[]> = {};
  for (const c of components) {
    (byZone[c.zone] ??= []).push(c);
  }
  for (const zone of Object.keys(byZone)) {
    byZone[zone].sort((a, b) => dagreY(a.id) - dagreY(b.id));
  }

  const positions: PositionedNode[] = [];

  // 3. Main flow columns: src → ing → platform → cons → ppl, stacked downward.
  let mainMaxY = 0;
  for (const [zone, colIdx] of Object.entries(COLUMN_INDEX)) {
    const list = byZone[zone] ?? [];
    const x = colIdx * COL_SPACING;
    list.forEach((c, i) => {
      const y = i * ROW_SPACING;
      positions.push({ id: c.id, position: { x, y } });
      if (y > mainMaxY) mainMaxY = y;
    });
  }

  // 4. `top` band: same column as platform, lifted above it (negative y).
  const topList = byZone["top"] ?? [];
  const topX = COLUMN_INDEX["platform"] * COL_SPACING;
  topList.forEach((c, i) => {
    const y = -(BAND_GAP + (topList.length - i) * ROW_SPACING);
    positions.push({ id: c.id, position: { x: topX, y } });
  });

  // 5. `cloud` band: horizontal rows along the bottom, wrapping every 6 nodes.
  const cloudList = byZone["cloud"] ?? [];
  const cloudY = mainMaxY + BAND_GAP;
  const perRow = 6;
  cloudList.forEach((c, i) => {
    const row = Math.floor(i / perRow);
    const col = i % perRow;
    const x = col * COL_SPACING;
    const y = cloudY + row * ROW_SPACING;
    positions.push({ id: c.id, position: { x, y } });
  });

  return positions;
}
