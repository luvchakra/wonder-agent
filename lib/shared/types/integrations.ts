import type { SourcedIdentityField as _SourcedIdentityField } from "./agent-identity";

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

// ---------------------------------------------------------------------------
// WonderID identity sources (INTEGRATION-P0-08/09, 2026-09-26).
// ---------------------------------------------------------------------------

export const IDENTITY_SOURCE_TEMPLATES = ["csv", "scim", "rest", "hr_api", "integration"] as const;
export type IdentitySourceTemplate = (typeof IDENTITY_SOURCE_TEMPLATES)[number];

/** Identity types a source may create (never AI agents: they are registered). */
export const SOURCE_IDENTITY_TYPES = ["HUMAN", "EXTERNAL", "MACHINE", "SERVICE_ACCOUNT", "APPLICATION", "WORKLOAD", "API"] as const;

export const LEAVER_STRATEGIES = ["disable", "flag", "none"] as const;
export type LeaverStrategy = (typeof LEAVER_STRATEGIES)[number];

/** Where a source column can go: an identity field, its own id, or its manager's id. */
export const IDENTITY_SOURCE_TARGETS = [
  "externalId",
  "managerExternalId",
  "displayName",
  "email",
  "username",
  "subtype",
  "department",
  "title",
  "businessUnit",
  "location",
  "employmentType",
  "organization",
  "startDate",
  "endDate",
  "status",
] as const;
export type IdentitySourceTarget = (typeof IDENTITY_SOURCE_TARGETS)[number];
export type AttributeMapping = { source: string; target: IdentitySourceTarget };

export const CORRELATION_KINDS = ["email", "username", "composite"] as const;
export type CorrelationRule = { kind: (typeof CORRELATION_KINDS)[number]; fields?: _SourcedIdentityField[] };

export type IdentitySource = {
  id: string;
  tenantId: string;
  name: string;
  template: IdentitySourceTemplate;
  integrationId: string | null;
  identityType: (typeof SOURCE_IDENTITY_TYPES)[number];
  authoritative: boolean;
  priority: number;
  authoritativeFields: _SourcedIdentityField[];
  attributeMappings: AttributeMapping[];
  correlationRules: CorrelationRule[];
  leaverStrategy: LeaverStrategy;
  leaverThresholdPercent: number;
  schedule: "manual" | "daily" | "hourly";
  status: "active" | "paused";
  createdAt: string;
  updatedAt: string;
};

export type ReconciliationRunStatus = "queued" | "running" | "succeeded" | "partial" | "failed";

export type ReconciliationRun = {
  id: string;
  sourceId: string;
  trigger: "upload" | "integration" | "manual";
  mode: "full" | "partial";
  status: ReconciliationRunStatus;
  recordsSeen: number;
  recordsInvalid: number;
  createdCount: number;
  updatedCount: number;
  unchangedCount: number;
  pendingCount: number;
  leaverCount: number;
  errorCount: number;
  guardTripped: boolean;
  /** A preview ("stage") run: planned, nothing changed. */
  dryRun: boolean;
  errors: { ref?: string; message: string }[];
  changes: { ref: string; identityId: string | null; action: string; changed?: string[] }[];
  startedAt: string | null;
  endedAt: string | null;
  createdAt: string;
};

export type PendingCorrelation = {
  id: string;
  sourceId: string;
  runId: string | null;
  externalId: string;
  normalized: Record<string, unknown>;
  candidateIdentityIds: string[];
  reason: string;
  status: "pending" | "linked" | "created" | "dismissed";
  resolvedIdentityId: string | null;
  createdAt: string;
};
