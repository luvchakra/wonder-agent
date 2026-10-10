import type { ConnectorCategory, ResourceKind } from "@/modules/integrations/framework/types";

export const CATEGORY_LABEL: Record<ConnectorCategory, string> = {
  hr: "HR systems",
  identity_provider: "Identity providers",
  directory: "Directories",
  application: "Applications",
  database: "Databases",
  secrets: "Secrets managers",
  infrastructure: "Infrastructure",
  ai_runtime: "AI agents and MCP",
  event_source: "Events and webhooks",
  other: "Other",
};

export const RESOURCE_LABEL: Record<ResourceKind, string> = {
  identity: "people",
  account: "accounts",
  entitlement: "roles and groups",
  access_grant: "who has what",
  application: "applications",
  policy: "policies",
  mcp_server: "MCP server",
  mcp_tool: "MCP tools",
  mcp_resource: "MCP resources",
};

export const RECEIVE_LABEL: Record<string, string> = {
  runtimeEvents: "agent activity",
  webhook: "webhooks",
  gateway: "Runtime Gateway calls",
};

/** One line: what a connector reads and what it receives. */
export function connectorSummary(resources: ResourceKind[], receives: string[]): string {
  const parts: string[] = [];
  if (resources.length) parts.push(`Reads ${resources.map((r) => RESOURCE_LABEL[r]).join(", ")}`);
  if (receives.length) parts.push(`${resources.length ? "receives" : "Receives"} ${receives.map((r) => RECEIVE_LABEL[r] ?? r).join(", ")}`);
  return parts.join("; ");
}
