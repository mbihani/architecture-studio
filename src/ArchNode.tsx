import { memo } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";

export interface ArchNodeData {
  name: string;
  category: string;
  zone: string;
  icon: string;
  description: string;
}

export const CATEGORY_COLORS: Record<string, string> = {
  source: "#2563eb",
  ingestion: "#7c3aed",
  platform: "#16a34a",
  consumer: "#ea580c",
  cloud: "#6b7280",
  usecase: "#dc2626",
};

/**
 * Custom React Flow node: a compact card showing the category colour as a
 * left accent + icon badge, the component name, and a tiny category/icon caption.
 */
function ArchNode({ data, selected }: NodeProps) {
  const d = data as ArchNodeData;
  const color = CATEGORY_COLORS[d.category] ?? "#6b7280";
  const badge = (d.icon || d.name || "?").slice(0, 2).toUpperCase();

  return (
    <div
      className="arch-node"
      style={{
        borderColor: color,
        boxShadow: selected ? `0 0 0 2px ${color}` : undefined,
      }}
      title={d.description || d.name}
    >
      <Handle type="target" position={Position.Left} style={{ background: color }} />
      <div className="arch-node__icon" style={{ background: color }}>
        {badge}
      </div>
      <div className="arch-node__body">
        <div className="arch-node__name">{d.name}</div>
        <div className="arch-node__meta">
          {d.category}
          {d.icon ? ` · ${d.icon}` : ""}
        </div>
      </div>
      <Handle type="source" position={Position.Right} style={{ background: color }} />
    </div>
  );
}

export default memo(ArchNode);
