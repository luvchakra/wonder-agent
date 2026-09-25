/**
 * Shared contracts owned by the Integration Agent (docs/plan/03-INTEGRATION-AGENT-BACKLOG.md).
 * Other modules import these instead of redefining connector/import shapes,
 * and must read imported data only through modules/integrations/service.ts's
 * getNormalizedObjects() — never by querying integration_objects directly.
 */

export type IntegrationCategory =
  | "iam_iga"
  | "pam"
  | "cloud"
  | "ai_runtime"
  | "mcp"
  | "siem"
  | "ticketing"
  | "custom_api";

export type IntegrationType = {
  id: string;
  displayName: string;
  category: IntegrationCategory;
  defaultCapabilities: ConnectorCapabilities;
};

export type ConnectorCapabilities = {
  importIdentities?: boolean;
  importAccounts?: boolean;
  importApplications?: boolean;
  importEntitlements?: boolean;
  importAccess?: boolean;
  importPolicies?: boolean;
  importActivity?: boolean;
  provision?: boolean;
  deprovision?: boolean;
};

export type IntegrationStatus = "configured" | "connected" | "error" | "disabled";

export type Integration = {
  id: string;
  tenantId: string;
  integrationTypeId: string;
  name: string;
  config: Record<string, unknown>;
  capabilities: ConnectorCapabilities;
  status: IntegrationStatus;
  lastSyncAt: string | null;
  nextSyncAt: string | null;
  createdAt: string;
  hasCredentials: boolean;
};

export type AuthType = "oauth2" | "api_key" | "basic" | "bearer" | "mtls";

export type SyncJobTrigger = "manual" | "scheduled";
export type SyncJobStatus = "queued" | "running" | "succeeded" | "failed" | "partial";

export type IntegrationSyncJob = {
  id: string;
  tenantId: string;
  integrationId: string;
  trigger: SyncJobTrigger;
  status: SyncJobStatus;
  startedAt: string | null;
  endedAt: string | null;
  recordsProcessed: number;
  recordsFailed: number;
  errors: unknown[];
  retryCount: number;
  correlationId: string;
  createdAt: string;
};

export type IntegrationObjectType =
  | "identity"
  | "account"
  | "application"
  | "entitlement"
  | "access_grant"
  | "policy"
  | "activity"
  // INTEGRATION-P0-06: MCP object families.
  | "mcp_server"
  | "mcp_tool"
  | "mcp_resource";

export type IntegrationObject = {
  id: string;
  tenantId: string;
  integrationId: string;
  objectType: IntegrationObjectType;
  externalId: string;
  raw: Record<string, unknown>;
  normalized: Record<string, unknown>;
  syncJobId: string | null;
  importedAt: string;
};

export type IntegrationMapping = {
  id: string;
  integrationId: string;
  objectType: string;
  sourceField: string;
  targetField: string;
};

// --- Normalized shapes connectors produce ---------------------------------

export type NormalizedIdentity = {
  externalId: string;
  displayName?: string;
  email?: string;
  identityType?: string;
};

export type NormalizedAccount = {
  externalId: string;
  application: string;
  owner?: string;
  entitlements?: string[];
};

export type NormalizedApplication = {
  externalId: string;
  name: string;
  category?: string;
};

export type NormalizedEntitlement = {
  externalId: string;
  application: string;
  name: string;
  dataClassification?: string;
  privilegeLevel?: "standard" | "elevated" | "admin";
};

export type NormalizedAccessGrant = {
  externalId: string;
  accountExternalId: string;
  entitlementExternalId: string;
  grantType?: string;
};

export type NormalizedPolicy = {
  externalId: string;
  name: string;
  description?: string;
};

export type NormalizedRuntimeEvent = {
  externalId: string;
  agentIdentityRef?: string;
  eventTime: string;
  source: "mcp" | "rest" | "webhook";
  tool?: string;
  application?: string;
  resource?: string;
  action: string;
  dataClassification?: string;
  success: boolean;
};

export type DiscoveredObject = {
  externalRef: string;
  objectType: IntegrationObjectType;
  summary: Record<string, unknown>;
};

export type AccessRequestInput = {
  accountExternalRef: string;
  entitlementExternalRef: string;
  justification: string;
};

/**
 * INTEGRATION-P0-06 (master P0-10) — the MCP inventory Integration
 * publishes: each MCP integration's server, its declared tools and its
 * resources, from `integration_objects` families `mcp_server` /
 * `mcp_tool` / `mcp_resource`. `operation` is derived deterministically
 * from the tool's own annotations first, then its name (never by a
 * model); "unknown" when neither says.
 */
export type McpToolOperation = "read" | "write" | "unknown";

export type McpTool = {
  integrationId: string;
  name: string;
  description: string | null;
  operation: McpToolOperation;
  /** How the operation was decided: the server's annotation, or the tool name. */
  operationBasis: "annotation" | "name" | "none";
  destructive: boolean;
  inputSchema: Record<string, unknown> | null;
  discoveredAt: string;
  /** False when the latest discovery no longer listed it (kept as evidence, never deleted). */
  stillDeclared: boolean;
};

export type McpResource = {
  integrationId: string;
  uri: string;
  name: string | null;
  mimeType: string | null;
  discoveredAt: string;
  stillDeclared: boolean;
};

export type McpServerInventory = {
  integrationId: string;
  integrationName: string;
  endpoint: string | null;
  serverName: string | null;
  serverVersion: string | null;
  protocolVersion: string | null;
  lastDiscoveredAt: string | null;
  tools: McpTool[];
  resources: McpResource[];
};
