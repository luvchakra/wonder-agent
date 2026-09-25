import "server-only";

import type { Integration, IntegrationObject, McpResource, McpServerInventory, McpTool, McpToolOperation } from "@/lib/shared/types/integrations";
import { listIntegrations } from "./integrations";
import { getNormalizedObjectsForTenant } from "./objects";

/**
 * INTEGRATION-P0-06 (master P0-10) — the published MCP inventory: every
 * MCP integration in the tenant with its server identity, declared tools
 * (read / write / unknown) and resources. Four tenant-wide reads in one
 * parallel wave (§15), under RLS with the tenant filtered explicitly
 * (§14). Consumed by the MCP screens and, later, by Access.
 *
 * A tool or resource missing from the latest discovery is kept and marked
 * `stillDeclared: false`, never deleted: it may still be what an agent
 * used, and it is evidence.
 */

const str = (v: unknown): string | null => (typeof v === "string" ? v : null);
const OPERATIONS: McpToolOperation[] = ["read", "write", "unknown"];
const basisOf = (v: unknown): McpTool["operationBasis"] => (v === "annotation" || v === "name" ? v : "none");

/** Pure: groups the three object families under their integration. */
export function buildMcpInventory(integrations: Integration[], objects: IntegrationObject[]): McpServerInventory[] {
  const mcp = integrations.filter((i) => i.integrationTypeId === "mcp");
  const byIntegration = new Map<string, IntegrationObject[]>();
  for (const o of objects) {
    const list = byIntegration.get(o.integrationId) ?? [];
    list.push(o);
    byIntegration.set(o.integrationId, list);
  }

  return mcp.map((integration) => {
    const own = byIntegration.get(integration.id) ?? [];
    const server = own.find((o) => o.objectType === "mcp_server");
    // Anything imported before the latest server record was not re-declared by that discovery.
    const declared = (o: IntegrationObject) => !server || o.importedAt >= server.importedAt;

    const tools: McpTool[] = own
      .filter((o) => o.objectType === "mcp_tool")
      .map((o) => {
        const n = o.normalized;
        const operation = OPERATIONS.includes(n.operation as McpToolOperation) ? (n.operation as McpToolOperation) : "unknown";
        return {
          integrationId: integration.id,
          name: str(n.name) ?? o.externalId,
          description: str(n.description),
          operation,
          operationBasis: basisOf(n.operationBasis),
          destructive: n.destructive === true,
          inputSchema: typeof n.inputSchema === "object" && n.inputSchema !== null ? (n.inputSchema as Record<string, unknown>) : null,
          discoveredAt: o.importedAt,
          stillDeclared: declared(o),
        };
      })
      .sort((a, b) => a.name.localeCompare(b.name));

    const resources: McpResource[] = own
      .filter((o) => o.objectType === "mcp_resource")
      .map((o) => ({
        integrationId: integration.id,
        uri: str(o.normalized.uri) ?? o.externalId,
        name: str(o.normalized.name),
        mimeType: str(o.normalized.mimeType),
        discoveredAt: o.importedAt,
        stillDeclared: declared(o),
      }))
      .sort((a, b) => a.uri.localeCompare(b.uri));

    return {
      integrationId: integration.id,
      integrationName: integration.name,
      endpoint: str(server?.normalized.endpoint) ?? str(integration.config.baseUrl),
      serverName: str(server?.normalized.serverName),
      serverVersion: str(server?.normalized.serverVersion),
      protocolVersion: str(server?.normalized.protocolVersion),
      lastDiscoveredAt: server?.importedAt ?? null,
      tools,
      resources,
    };
  });
}

export async function getMcpInventory(tenantId: string): Promise<McpServerInventory[]> {
  const [integrations, servers, tools, resources] = await Promise.all([
    listIntegrations(tenantId),
    getNormalizedObjectsForTenant(tenantId, "mcp_server"),
    getNormalizedObjectsForTenant(tenantId, "mcp_tool"),
    getNormalizedObjectsForTenant(tenantId, "mcp_resource"),
  ]);
  return buildMcpInventory(integrations, [...servers, ...tools, ...resources]);
}
