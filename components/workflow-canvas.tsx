'use client';
import { useMemo, useState } from 'react';
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  Handle,
  Position,
  applyNodeChanges,
  type Node,
  type NodeProps,
  type NodeChange,
} from '@xyflow/react';
import { Bot, Check, LoaderCircle, Plug, TriangleAlert } from 'lucide-react';
import type { AgentNode, Attempt, Workflow } from '@/lib/workbench/types';
import '@xyflow/react/dist/style.css';
type Data = {
  agent: AgentNode;
  status: string;
  calls: number;
  selected?: boolean;
};
function AgentCard({ data, selected }: NodeProps<Node<Data>>) {
  return (
    <div className={`agent-card ${data.status} ${selected ? 'chosen' : ''}`}>
      <Handle type="target" position={Position.Top} />
      <div className="agent-card-top">
        <span className="agent-glyph">
          <Bot size={17} />
        </span>
        <span>{data.agent.role}</span>
        {data.status === 'done' ? (
          <Check size={15} />
        ) : data.status === 'working' ? (
          <LoaderCircle size={15} className="spin" />
        ) : data.status === 'blocked' ? (
          <TriangleAlert size={15} />
        ) : (
          <span className="agent-id">{data.agent.id.slice(0, 14)}</span>
        )}
      </div>
      <strong>{data.agent.name}</strong>
      <p>{data.agent.instruction}</p>
      <div className="agent-tools">
        {data.agent.toolkits.length ? (
          data.agent.toolkits.map((t) => (
            <span key={t}>
              <Plug size={10} />
              {t}
            </span>
          ))
        ) : (
          <span>Reasoning & content</span>
        )}
        {data.calls > 0 && <b>{data.calls} calls</b>}
      </div>
      <Handle type="source" position={Position.Bottom} />
    </div>
  );
}
const nodeTypes = { agent: AgentCard };
function generateNodes(workflow: Workflow, attempt?: Attempt): Node<Data>[] {
  const levels = new Map<string, number>();
  const level = (n: AgentNode): number => {
    if (levels.has(n.id)) return levels.get(n.id)!;
    const v = n.dependsOn.length
      ? Math.max(
          ...n.dependsOn.map((id) =>
            level(workflow.nodes.find((x) => x.id === id)!),
          ),
        ) + 1
      : 0;
    levels.set(n.id, v);
    return v;
  };
  workflow.nodes.forEach(level);
  const counts = new Map<number, number>();
  const totals = new Map<number, number>();
  levels.forEach((l) => totals.set(l, (totals.get(l) ?? 0) + 1));
  return workflow.nodes.map((n) => {
    const l = levels.get(n.id)!,
      i = counts.get(l) ?? 0;
    counts.set(l, i + 1);
    return {
      id: n.id,
      type: 'agent',
      position: { x: (i - (totals.get(l)! - 1) / 2) * 330, y: l * 240 },
      data: {
        agent: n,
        status:
          attempt?.states.find((s) => s.nodeId === n.id)?.status ?? 'pending',
        calls:
          attempt?.traces.filter((t) => t.nodeId === n.id && t.kind === 'tool')
            .length ?? 0,
      },
    };
  });
}

export default function WorkflowCanvas({
  workflow,
  attempt,
  onSelect,
}: {
  workflow: Workflow;
  attempt?: Attempt;
  onSelect: (node: AgentNode) => void;
}) {
  const generated = useMemo(
    () => generateNodes(workflow, attempt),
    [workflow, attempt],
  );
  const [layout, setLayout] = useState<
    Record<string, { position: { x: number; y: number }; selected?: boolean }>
  >({});
  const nodes = generated.map((n) => ({ ...n, ...layout[n.id] }));
  const edges = workflow.nodes.flatMap((n) =>
    n.dependsOn.map((id) => ({
      id: `${id}-${n.id}`,
      source: id,
      target: n.id,
      type: 'smoothstep',
      animated:
        attempt?.states.find((s) => s.nodeId === n.id)?.status === 'working',
      style: {
        stroke:
          attempt?.states.find((s) => s.nodeId === id)?.status === 'done'
            ? '#79c5ac'
            : '#4a4d52',
        strokeWidth: 1.6,
      },
    })),
  );
  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      nodeTypes={nodeTypes}
      onNodesChange={(changes: NodeChange<Node<Data>>[]) =>
        setLayout(
          Object.fromEntries(
            applyNodeChanges(changes, nodes).map((n) => [
              n.id,
              { position: n.position, selected: n.selected },
            ]),
          ),
        )
      }
      onNodeClick={(_, node) => onSelect(node.data.agent)}
      nodesConnectable={false}
      deleteKeyCode={null}
      fitView
      fitViewOptions={{ padding: 0.25, maxZoom: 1 }}
      minZoom={0.25}
      maxZoom={1.6}
      colorMode="dark"
      proOptions={{ hideAttribution: true }}
    >
      <Background color="#3b3e42" gap={22} size={1} />
      <Controls showInteractive={false} />
      <MiniMap
        pannable
        zoomable
        nodeColor="#343a3c"
        maskColor="rgba(20,23,25,.7)"
      />
    </ReactFlow>
  );
}
