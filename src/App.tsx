import { useCallback, useEffect, useRef, useState } from "react";
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  useNodesState,
  useEdgesState,
  addEdge,
  MarkerType,
  useReactFlow,
  type Node,
  type Edge,
  type Connection,
  type NodeTypes,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { toPng } from "html-to-image";

import ArchNode, { CATEGORY_COLORS } from "./ArchNode";
import { computeLayout } from "./layout";
import type { ArchitectureData, ArchComponent, ArchEdge } from "./types";

const EDGE_COLORS: Record<string, string> = {
  flow: "#2563eb",
  feeds: "#16a34a",
  related: "#9ca3af",
  uses: "#ea580c",
};

const CATEGORIES = ["source", "ingestion", "platform", "consumer", "cloud", "usecase"];

const nodeTypes: NodeTypes = { arch: ArchNode };

interface ArchNodeData {
  name: string;
  category: string;
  zone: string;
  icon: string;
  description: string;
}

interface Meta {
  name: string;
  category: string;
}

function Studio() {
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [category, setCategory] = useState("all");
  const [search, setSearch] = useState("");

  // id → {name, category} for fast, position-independent visibility checks.
  const nodeMeta = useRef<Map<string, Meta>>(new Map());
  const addCounter = useRef(0);
  const reactFlow = useReactFlow();

  // ---- Load architecture.json (same-origin fetch of a bundled asset) ----
  useEffect(() => {
    let cancelled = false;
    fetch("/architecture.json")
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json() as Promise<ArchitectureData>;
      })
      .then((data: ArchitectureData) => {
        if (cancelled) return;
        const pos = new Map(
          computeLayout(data.components, data.edges).map((p) => [p.id, p.position]),
        );
        const ns: Node[] = data.components.map((c: ArchComponent) => ({
          id: c.id,
          type: "arch",
          position: pos.get(c.id) ?? { x: 0, y: 0 },
          data: {
            name: c.name,
            category: c.category,
            zone: c.zone,
            icon: c.icon ?? "",
            description: c.description ?? "",
          } as ArchNodeData,
        }));
        const es: Edge[] = data.edges.map((e: ArchEdge) => {
          const color = EDGE_COLORS[e.kind] ?? "#9ca3af";
          return {
            id: e.id,
            source: e.sourceId,
            target: e.targetId,
            type: "smoothstep",
            style: { stroke: color, strokeWidth: 1.5 },
            markerEnd: { type: MarkerType.ArrowClosed, color, width: 18, height: 18 },
            data: { kind: e.kind },
          };
        });
        ns.forEach((n) =>
          nodeMeta.current.set(n.id, {
            name: (n.data as ArchNodeData).name,
            category: (n.data as ArchNodeData).category,
          }),
        );
        setNodes(ns);
        setEdges(es);
        setLoading(false);
        // Fit once after the first paint of the nodes.
        window.requestAnimationFrame(() =>
          reactFlow.fitView({ padding: 0.12, duration: 0 }),
        );
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : String(e));
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [reactFlow, setNodes, setEdges]);

  // ---- Filtering (category dropdown + name search) ----
  useEffect(() => {
    const q = search.trim().toLowerCase();
    const visible = new Set<string>();
    nodeMeta.current.forEach((m, id) => {
      const catOk = category === "all" || m.category === category;
      const nameOk = q === "" || m.name.toLowerCase().includes(q);
      if (catOk && nameOk) visible.add(id);
    });
    setNodes((ns) => ns.map((n) => ({ ...n, hidden: !visible.has(n.id) })));
    setEdges((es) =>
      es.map((e) => ({
        ...e,
        hidden: !(visible.has(e.source) && visible.has(e.target)),
      })),
    );
  }, [category, search, setNodes, setEdges]);

  // ---- Interactions ----
  const onConnect = useCallback(
    (conn: Connection) => {
      const color = "#9ca3af";
      setEdges((eds) =>
        addEdge(
          {
            ...conn,
            type: "smoothstep",
            style: { stroke: color, strokeWidth: 1.5 },
            markerEnd: { type: MarkerType.ArrowClosed, color, width: 18, height: 18 },
          },
          eds,
        ),
      );
    },
    [setEdges],
  );

  const addComponent = useCallback(() => {
    const n = addCounter.current++;
    const id =
      (typeof crypto !== "undefined" && crypto.randomUUID?.()) ||
      `node-${Date.now()}-${n}`;
    const name = `New Component ${n + 1}`;
    const cat = "platform";
    nodeMeta.current.set(id, { name, category: cat });

    // Drop the new node near the centre of the current viewport.
    const center = reactFlow.screenToFlowPosition({
      x: window.innerWidth / 2,
      y: window.innerHeight / 2,
    });

    const q = search.trim().toLowerCase();
    const matches =
      (category === "all" || cat === category) &&
      (q === "" || name.toLowerCase().includes(q));

    setNodes((ns) => [
      ...ns,
      {
        id,
        type: "arch",
        position: center,
        data: { name, category: cat, zone: "platform", icon: "", description: "" },
        hidden: !matches,
      },
    ]);
  }, [reactFlow, category, search, setNodes]);

  const deleteSelected = useCallback(() => {
    const selNodeIds = nodes.filter((n) => n.selected).map((n) => n.id);
    const anyEdge = edges.some((e) => e.selected);
    if (selNodeIds.length === 0 && !anyEdge) return;
    selNodeIds.forEach((id) => nodeMeta.current.delete(id));
    const rm = new Set(selNodeIds);
    setNodes((ns) => ns.filter((n) => !n.selected));
    setEdges((es) =>
      es.filter((e) => !e.selected && !rm.has(e.source) && !rm.has(e.target)),
    );
  }, [nodes, edges, setNodes, setEdges]);

  const exportPng = useCallback(async () => {
    const el = document.querySelector(".react-flow") as HTMLElement | null;
    if (!el) return;
    try {
      reactFlow.fitView({ padding: 0.15, duration: 0 });
      await new Promise((r) => setTimeout(r, 350));
      const dataUrl = await toPng(el, {
        backgroundColor: "#ffffff",
        filter: (node) => {
          if (!(node instanceof HTMLElement)) return true;
          return (
            !node.classList.contains("react-flow__minimap") &&
            !node.classList.contains("react-flow__controls") &&
            !node.classList.contains("react-flow__attribution")
          );
        },
      });
      const a = document.createElement("a");
      a.href = dataUrl;
      a.download = "architecture.png";
      a.click();
    } catch (e) {
      console.error("Export PNG failed", e);
      alert("Export PNG failed: " + (e instanceof Error ? e.message : String(e)));
    }
  }, [reactFlow]);

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div>
          <h1 className="sidebar__title">Architecture Studio</h1>
          <p className="sidebar__subtitle">
            React Flow POC — interactive, editable node/edge graph. No iframe,
            fully same-origin.
          </p>
        </div>

        <div className="sidebar__group">
          <label className="sidebar__label" htmlFor="cat-filter">
            Category
          </label>
          <select
            id="cat-filter"
            value={category}
            onChange={(e) => setCategory(e.target.value)}
          >
            <option value="all">All categories</option>
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {c[0].toUpperCase() + c.slice(1)}
              </option>
            ))}
          </select>
        </div>

        <div className="sidebar__group">
          <label className="sidebar__label" htmlFor="name-search">
            Search by name
          </label>
          <input
            id="name-search"
            type="text"
            placeholder="e.g. Delta, Genie, MLflow"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        <div className="sidebar__group">
          <span className="sidebar__label">Legend</span>
          <div className="sidebar__legend">
            {CATEGORIES.map((c) => (
              <span key={c}>
                <i style={{ background: CATEGORY_COLORS[c] }} />
                {c}
              </span>
            ))}
          </div>
        </div>

        <div className="sidebar__buttons">
          <button
            type="button"
            className="sidebar__btn sidebar__btn--primary"
            onClick={addComponent}
          >
            + Add Component
          </button>
          <button
            type="button"
            className="sidebar__btn sidebar__btn--danger"
            onClick={deleteSelected}
          >
            🗑 Delete Selected
          </button>
          <button type="button" className="sidebar__btn" onClick={exportPng}>
            ⬇ Export PNG
          </button>
        </div>
      </aside>

      <div className="flow-wrap">
        {loading && <div className="flow-loading">Loading architecture…</div>}
        {error && (
          <div className="flow-loading">Failed to load: {error}</div>
        )}
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          nodeTypes={nodeTypes}
          fitView
          minZoom={0.05}
          maxZoom={2}
          proOptions={{ hideAttribution: false }}
        >
          <Background variant={BackgroundVariant.Dots} gap={20} size={1} color="#cbd5e1" />
          <Controls />
          <MiniMap
            pannable
            zoomable
            nodeColor={(n) =>
              CATEGORY_COLORS[(n.data as ArchNodeData)?.category] ?? "#94a3b8"
            }
            maskColor="rgba(15, 23, 42, 0.08)"
          />
        </ReactFlow>
      </div>
    </div>
  );
}

export default function App() {
  return (
    <ReactFlowProvider>
      <Studio />
    </ReactFlowProvider>
  );
}
