import { useCallback, useMemo } from 'react';
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  Controls,
  MiniMap,
  useNodesState,
  useEdgesState,
  useReactFlow,
  addEdge,
  MarkerType,
  type Connection,
  type Edge,
  type Node,
} from '@xyflow/react';
import dagre from '@dagrejs/dagre';
import ComponentNode from './ComponentNode';
import {
  components as initialComponents,
  edges as initialEdges,
  CATEGORY_META,
  EDGE_KIND_COLOR,
  type Category,
  type EdgeKind,
} from './data';

const NODE_W = 200;
const NODE_H = 76;

function edgeStyle(kind: EdgeKind) {
  const color = EDGE_KIND_COLOR[kind];
  return {
    type: 'smoothstep' as const,
    style: { stroke: color, strokeWidth: 1.5 },
    markerEnd: { type: MarkerType.ArrowClosed, color, width: 18, height: 18 },
  };
}

// dagre auto-layout (left-to-right).
function layoutGraph(nodes: Node[], edges: Edge[]) {
  const g = new dagre.graphlib.Graph();
  g.setGraph({ rankdir: 'LR', nodesep: 36, ranksep: 90 });
  g.setDefaultEdgeLabel(() => ({}));
  nodes.forEach((n) => g.setNode(n.id, { width: NODE_W, height: NODE_H }));
  edges.forEach((e) => g.setEdge(e.source, e.target));
  dagre.layout(g);
  return {
    nodes: nodes.map((n) => {
      const p = g.node(n.id);
      return { ...n, position: { x: p.x - NODE_W / 2, y: p.y - NODE_H / 2 } };
    }),
    edges,
  };
}

const initial = layoutGraph(
  initialComponents.map((c) => ({
    id: c.id,
    type: 'component',
    position: { x: 0, y: 0 },
    data: { name: c.name, category: c.category, description: c.description },
  })) as Node[],
  initialEdges.map((e, i) => ({
    id: `e-${e.source}-${e.target}-${e.kind}-${i}`,
    source: e.source,
    target: e.target,
    ...edgeStyle(e.kind),
  })) as Edge[],
);

let seq = 0;
const nextId = () => `new-${Date.now()}-${seq++}`;

function Flow() {
  const [nodes, setNodes, onNodesChange] = useNodesState(initial.nodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initial.edges);
  const { screenToFlowPosition } = useReactFlow();

  const nodeTypes = useMemo(() => ({ component: ComponentNode }), []);
  const onConnect = useCallback(
    (c: Connection) => setEdges((eds) => addEdge({ ...c, ...edgeStyle('related') }, eds)),
    [setEdges],
  );

  const addComponent = useCallback(() => {
    const pos = screenToFlowPosition({ x: window.innerWidth / 2, y: window.innerHeight / 2 });
    const id = nextId();
    setNodes((nds) =>
      nds.concat({
        id,
        type: 'component',
        position: pos,
        data: { name: `New Component ${id.slice(-4)}`, category: 'platform' as Category, description: 'Added from sidebar' },
      }),
    );
  }, [screenToFlowPosition, setNodes]);

  const miniColor = useCallback(
    (n: Node) => CATEGORY_META[(n.data as { category?: Category }).category ?? 'platform']?.color ?? '#94a3b8',
    [],
  );

  return (
    <div className="app">
      <aside className="sidebar">
        <h1>React Flow POC</h1>
        <p className="sub">Databricks architecture viewer</p>
        <button className="add-btn" onClick={addComponent}>+ Add Component</button>
        <p className="hint">
          Drag nodes · scroll to zoom · click to select · Delete to remove · drag
          handle-to-handle to connect.
        </p>
        <section className="legend">
          <h2>Categories</h2>
          {(Object.keys(CATEGORY_META) as Category[]).map((k) => (
            <div key={k} className="legend-row">
              <span className="swatch" style={{ background: CATEGORY_META[k].color }} />
              <span>{CATEGORY_META[k].label}</span>
            </div>
          ))}
          <h2>Edges</h2>
          {(Object.keys(EDGE_KIND_COLOR) as EdgeKind[]).map((k) => (
            <div key={k} className="legend-row">
              <span className="line" style={{ background: EDGE_KIND_COLOR[k] }} />
              <span>{k}</span>
            </div>
          ))}
        </section>
        <footer className="count">{nodes.length} nodes · {edges.length} edges</footer>
      </aside>
      <div className="canvas">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          nodeTypes={nodeTypes}
          fitView
          fitViewOptions={{ padding: 0.2 }}
          deleteKeyCode={['Backspace', 'Delete']}
        >
          <Background gap={16} size={1} />
          <Controls />
          <MiniMap pannable zoomable nodeColor={miniColor} />
        </ReactFlow>
      </div>
    </div>
  );
}

export default function App() {
  return (
    <ReactFlowProvider>
      <Flow />
    </ReactFlowProvider>
  );
}
