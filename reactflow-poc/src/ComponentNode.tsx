import { memo } from 'react';
import { Handle, Position, type NodeProps, type Node } from '@xyflow/react';
import { CATEGORY_META, type Category } from './data';

export type ComponentNodeData = {
  name: string;
  category: Category;
  description: string;
};

export type ComponentNodeType = Node<ComponentNodeData, 'component'>;

function ComponentNode({ data, selected }: NodeProps<ComponentNodeType>) {
  const meta = CATEGORY_META[data.category];
  return (
    <div
      className="comp-node"
      style={{
        borderLeftColor: meta?.color ?? '#94a3b8',
        boxShadow: selected ? '0 0 0 2px var(--accent)' : undefined,
      }}
    >
      <Handle type="target" position={Position.Left} className="handle" />
      <div className="comp-name">{data.name}</div>
      <div className="comp-desc">{data.description}</div>
      <Handle type="source" position={Position.Right} className="handle" />
    </div>
  );
}

export default memo(ComponentNode);
