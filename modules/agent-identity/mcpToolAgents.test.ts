import { describe, expect, it } from "vitest";
import { mcpToolAgentEntry } from "./mcpToolAgents";
import type { McpTool } from "@/lib/shared/types/integrations";

const server = { integrationId: "conn-1", integrationName: "WonderArk MCP", serverName: "wonderark" };
const tool = (over: Partial<McpTool> = {}): McpTool => ({
  integrationId: "conn-1",
  name: "draft_whatsapp_reply",
  description: "Drafts an answer to the latest customer message.",
  operation: "write",
  operationBasis: "annotation",
  destructive: false,
  inputSchema: null,
  discoveredAt: "2026-10-14T18:46:00Z",
  stillDeclared: true,
  kind: "ai_agent",
  kindReason: 'Name starts with "draft"',
  declaredAutonomy: null,
  declaredAiGenerated: false,
  ...over,
});

describe("mcpToolAgentEntry", () => {
  it("is an open, probable-agent candidate keyed on the connection and the tool", () => {
    const e = mcpToolAgentEntry(server, tool(), undefined, 7);
    expect(e).toMatchObject({ externalId: "draft_whatsapp_reply", integrationId: "conn-1", integrationRef: 7, sourceSystem: "conn-1", category: "new", classification: "PROBABLE_AGENT", candidateStatus: "open", owner: null, application: "wonderark", changeType: "NEW" });
    expect(e.confidenceScore).toBe(70);
    expect(e.signals.map((s) => s.signal)).toEqual(["AI runtime / MCP source", "Tool is an AI agent", "Acts, not only reads"]);
  });

  it("carries a recorded decision and marks a tool no longer declared as stale", () => {
    const linked = mcpToolAgentEntry(server, tool({ stillDeclared: false, operation: "read" }), { status: "linked", matchedAgentId: "agent-9" }, null);
    expect(linked).toMatchObject({ candidateStatus: "linked", linkedAgentId: "agent-9", changeType: "STALE", confidenceScore: 60 });
    expect(mcpToolAgentEntry(server, tool(), { status: "ignored", matchedAgentId: null }, null).candidateStatus).toBe("ignored");
  });
});
