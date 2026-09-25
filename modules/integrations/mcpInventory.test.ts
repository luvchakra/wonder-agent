// @vitest-environment node
import { describe, expect, it, vi } from "vitest";

vi.mock("./integrations", () => ({ listIntegrations: vi.fn() }));
vi.mock("./objects", () => ({ getNormalizedObjectsForTenant: vi.fn() }));

import { buildMcpInventory } from "./mcpInventory";
import type { Integration, IntegrationObject } from "@/lib/shared/types/integrations";

const integration = (id: string, type: string, name = id): Integration => ({
  id,
  tenantId: "t",
  integrationTypeId: type,
  name,
  config: { baseUrl: `https://${id}.example.com` },
  capabilities: {} as Integration["capabilities"],
  status: "connected",
  lastSyncAt: null,
  nextSyncAt: null,
  createdAt: "2026-09-01T00:00:00Z",
  hasCredentials: true,
});
const obj = (integrationId: string, objectType: IntegrationObject["objectType"], externalId: string, normalized: Record<string, unknown>, importedAt: string): IntegrationObject => ({
  id: `${integrationId}-${externalId}`,
  tenantId: "t",
  integrationId,
  objectType,
  externalId,
  raw: normalized,
  normalized,
  syncJobId: null,
  importedAt,
});

describe("buildMcpInventory (INTEGRATION-P0-06)", () => {
  it("groups each MCP integration's server, tools and resources; other integration types are not MCP servers", () => {
    const inv = buildMcpInventory(
      [integration("m1", "mcp", "Finance MCP"), integration("s1", "saviynt")],
      [
        obj("m1", "mcp_server", "server", { endpoint: "https://m1/mcp", serverName: "finance-mcp", serverVersion: "1.4.2", protocolVersion: "2025-06-18" }, "2026-09-25T10:00:00Z"),
        obj("m1", "mcp_tool", "query_ledger", { name: "query_ledger", operation: "read", operationBasis: "name" }, "2026-09-25T10:00:01Z"),
        obj("m1", "mcp_tool", "old_tool", { name: "old_tool", operation: "write", operationBasis: "annotation", destructive: true }, "2026-09-20T00:00:00Z"),
        obj("m1", "mcp_resource", "ledger://2026", { uri: "ledger://2026", name: "Ledger" }, "2026-09-25T10:00:02Z"),
      ],
    );
    expect(inv).toHaveLength(1);
    expect(inv[0]).toMatchObject({ integrationName: "Finance MCP", serverName: "finance-mcp", serverVersion: "1.4.2", endpoint: "https://m1/mcp", lastDiscoveredAt: "2026-09-25T10:00:00Z" });
    expect(inv[0].tools.map((t) => [t.name, t.operation, t.stillDeclared])).toEqual([
      ["old_tool", "write", false],
      ["query_ledger", "read", true],
    ]);
    expect(inv[0].tools[0].destructive).toBe(true);
    expect(inv[0].resources).toEqual([expect.objectContaining({ uri: "ledger://2026", stillDeclared: true })]);
  });

  it("an MCP integration never discovered still appears, with its configured endpoint and nothing declared", () => {
    const [server] = buildMcpInventory([integration("m2", "mcp")], []);
    expect(server).toMatchObject({ endpoint: "https://m2.example.com", serverName: null, lastDiscoveredAt: null, tools: [], resources: [] });
  });

  it("an unrecognised stored operation reads as unknown", () => {
    const [server] = buildMcpInventory([integration("m1", "mcp")], [obj("m1", "mcp_tool", "t", { operation: "admin" }, "2026-09-25T00:00:00Z")]);
    expect(server.tools[0]).toMatchObject({ name: "t", operation: "unknown", operationBasis: "none" });
  });
});
