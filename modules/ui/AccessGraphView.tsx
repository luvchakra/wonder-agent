"use client";

import ReactFlow, { Background, Controls, type Node, type Edge } from "reactflow";
import "reactflow/dist/style.css";
import type { AccessGraph, AccessGraphNodeType } from "@/lib/shared/types/access-governance";
import { EmptyState } from "./States";

const COLUMN_ORDER: AccessGraphNodeType[] = ["agent", "account", "application", "entitlement"];
const COLUMN_GAP_X = 260;
const ROW_GAP_Y = 90;

const NODE_STYLE: Record<AccessGraphNodeType, React.CSSProperties> = {
  agent: { borderColor: "var(--color-primary)" },
  account: { borderColor: "var(--color-info)" },
  application: { borderColor: "var(--color-secondary)" },
  entitlement: { borderColor: "var(--color-border)" },
};

/**
 * ACCESS-P0-03's published `AccessGraph` (nodes/edges) laid out left-to-
 * right by node type (agent → account → application/entitlement) — a
 * simple deterministic column layout, not a force-directed one, since the
 * graph is small (one agent's own access) and a stable, readable layout
 * matters more than automatic spacing for a governance review screen.
 */
export function layoutNodes(graph: AccessGraph): Node[] {
  const byType = new Map<AccessGraphNodeType, AccessGraph["nodes"]>();
  for (const n of graph.nodes) {
    const list = byType.get(n.type) ?? [];
    list.push(n);
    byType.set(n.type, list);
  }

  const nodes: Node[] = [];
  COLUMN_ORDER.forEach((type, columnIndex) => {
    const list = byType.get(type) ?? [];
    list.forEach((n, rowIndex) => {
      nodes.push({
        id: n.id,
        position: { x: columnIndex * COLUMN_GAP_X, y: rowIndex * ROW_GAP_Y },
        data: { label: n.label },
        style: {
          borderRadius: 8,
          borderWidth: 1.5,
          borderStyle: "solid",
          background: "var(--color-card)",
          color: "var(--color-card-foreground)",
          fontSize: 12,
          padding: "6px 10px",
          ...NODE_STYLE[type],
        },
      });
    });
  });
  return nodes;
}

export function toFlowEdges(graph: AccessGraph): Edge[] {
  return graph.edges.map((e, i) => ({
    id: `${e.source}->${e.target}-${i}`,
    source: e.source,
    target: e.target,
    label: e.relation.replace(/_/g, " "),
    style: { stroke: "var(--color-border)" },
    labelStyle: { fill: "var(--color-muted-foreground)", fontSize: 10 },
    labelBgStyle: { fill: "var(--color-background)" },
  }));
}

/**
 * EXPERIENCE-P0-11 — Effective Access Graph Visualization (PRD §34 screen
 * #6; CLAUDE.md §2's locked stack names a graph visualization library for
 * exactly this). Uses `reactflow`, already a declared dependency, rather
 * than introducing a second graph library. Read-only: nodes aren't
 * draggable/connectable — this is a review visualization, not an editor
 * (non-negotiable #9's spirit — nothing here can mutate access).
 */
export function AccessGraphView({ graph }: { graph: AccessGraph }) {
  if (graph.nodes.length === 0) {
    return <EmptyState title="No access graph to show yet" description="This agent has no effective access derived from any connected system or manual entry." />;
  }

  const nodes = layoutNodes(graph);
  const edges = toFlowEdges(graph);

  return (
    <div className="h-[26rem] rounded-lg border border-border bg-background">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        fitView
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable={false}
        proOptions={{ hideAttribution: true }}
      >
        <Background color="var(--color-border)" gap={16} />
        <Controls showInteractive={false} />
      </ReactFlow>
    </div>
  );
}
