// @vitest-environment node
import { describe, expect, it } from "vitest";
import { layoutNodes, toFlowEdges } from "./AccessGraphView";
import type { AccessGraph } from "@/lib/shared/types/access-governance";

const graph: AccessGraph = {
  agentId: "agent-1",
  nodes: [
    { id: "agent:agent-1", type: "agent", label: "agent-1" },
    { id: "account:acc-1", type: "account", label: "svc-account-1" },
    { id: "application:app-1", type: "application", label: "Snowflake" },
    { id: "entitlement:ent-1", type: "entitlement", label: "CustomerDB_READ" },
  ],
  edges: [
    { source: "agent:agent-1", target: "account:acc-1", relation: "has_account" },
    { source: "account:acc-1", target: "application:app-1", relation: "belongs_to" },
    { source: "account:acc-1", target: "entitlement:ent-1", relation: "direct" },
  ],
  rows: [],
};

describe("layoutNodes — EXPERIENCE-P0-11", () => {
  it("places nodes into columns by type in agent -> account -> application -> entitlement order", () => {
    const nodes = layoutNodes(graph);
    const byId = new Map(nodes.map((n) => [n.id, n]));
    expect(byId.get("agent:agent-1")!.position.x).toBe(0);
    expect(byId.get("account:acc-1")!.position.x).toBe(260);
    expect(byId.get("application:app-1")!.position.x).toBe(520);
    expect(byId.get("entitlement:ent-1")!.position.x).toBe(780);
  });

  it("carries the node label through to reactflow node data", () => {
    const nodes = layoutNodes(graph);
    const agentNode = nodes.find((n) => n.id === "agent:agent-1")!;
    expect(agentNode.data.label).toBe("agent-1");
  });

  it("returns an empty array for an empty graph", () => {
    expect(layoutNodes({ ...graph, nodes: [] })).toEqual([]);
  });
});

describe("toFlowEdges — EXPERIENCE-P0-11", () => {
  it("maps every graph edge to a reactflow edge with a humanized relation label", () => {
    const edges = toFlowEdges(graph);
    expect(edges).toHaveLength(3);
    expect(edges[0]).toMatchObject({ source: "agent:agent-1", target: "account:acc-1", label: "has account" });
    expect(edges[2].label).toBe("direct");
  });

  it("produces stable unique ids per edge", () => {
    const edges = toFlowEdges(graph);
    const ids = new Set(edges.map((e) => e.id));
    expect(ids.size).toBe(edges.length);
  });
});
