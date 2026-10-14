import type { DetectionSignal, DiscoveryInboxEntry } from "@/lib/shared/types/agent-identity";
import type { McpServerInventory, McpTool } from "@/lib/shared/types/integrations";

/**
 * Owner feedback 2026-10-14 ("draft_whatsapp_reply is actually an AI
 * agent"): a tool an MCP server declares can itself be an AI agent. Each
 * tool the integration inventory classifies as one (classifyToolKind, from
 * the server's own declaration) becomes a discovery-inbox candidate, keyed
 * like the connection's other objects (`<connection>::<tool name>`), so the
 * existing register / link / ignore flow records the decision. Pure and
 * deterministic (#9); a person decides, nothing is registered on its own.
 */
export function mcpToolAgentEntry(
  server: Pick<McpServerInventory, "integrationId" | "integrationName" | "serverName">,
  tool: McpTool,
  decision: { status: string; matchedAgentId: string | null } | undefined,
  integrationRef: number | null,
): DiscoveryInboxEntry {
  const signals: DetectionSignal[] = [
    { signal: "AI runtime / MCP source", source: server.integrationName, observedValue: "mcp", strength: "strong", scoreContribution: 35 },
    { signal: "Tool is an AI agent", source: server.integrationName, observedValue: `${tool.name}: ${tool.kindReason ?? "classified as an AI agent"}`, strength: "medium", scoreContribution: 25 },
  ];
  if (tool.operation === "write") {
    signals.push({ signal: "Acts, not only reads", source: server.integrationName, observedValue: "write tool", strength: "weak", scoreContribution: 10 });
  }
  const score = Math.min(100, signals.reduce((sum, s) => sum + s.scoreContribution, 0));
  return {
    externalId: tool.name,
    integrationId: server.integrationId,
    integrationRef,
    integrationName: server.integrationName,
    sourceSystem: server.integrationId,
    displayName: tool.name,
    identityType: "mcp_server",
    owner: null,
    application: server.serverName,
    category: "new",
    classification: "PROBABLE_AGENT",
    confidenceScore: score,
    confidenceLevel: score >= 80 ? "HIGH" : score >= 50 ? "MEDIUM" : "LOW",
    signals,
    changeType: tool.stillDeclared ? "NEW" : "STALE",
    candidateStatus: decision ? (decision.status === "linked" ? "linked" : "ignored") : "open",
    linkedAgentId: decision?.status === "linked" ? (decision.matchedAgentId ?? undefined) : undefined,
    lastSeenAt: tool.discoveredAt,
    raw: { name: tool.name, description: tool.description, operation: tool.operation },
  };
}
