import "server-only";

/**
 * The published contract for the Integration Agent's module
 * (docs/plan/03-INTEGRATION-AGENT-BACKLOG.md). Other modules must import
 * from this file only — never query integrations/integration_objects/etc.
 * directly, and never reach into connectors/* or a sibling file directly.
 *
 * Notably absent: anything that reads or returns a decrypted credential.
 * getDecryptedCredential() (modules/integrations/credentials.ts) is
 * intentionally NOT re-exported here — it exists only for this module's own
 * connector-invocation code paths (testIntegrationConnection, runSyncJob,
 * webhooks, MCP event ingestion).
 */

export {
  createIntegration,
  getIntegration,
  listIntegrations,
  listIntegrationTypes,
  testIntegrationConnection,
  type CreateIntegrationInput,
} from "./integrations";
export { setCredential } from "./credentials";
export { createSyncJob, runSyncJob, getSyncJob, listSyncJobs, listLatestCompletedSyncStarts } from "./syncJobs";
export { getNormalizedObjects, getNormalizedObjectsForTenant } from "./objects";
export { createMapping, listMappings } from "./mappings";
export { discoverMcpTools } from "./mcpTools";
export { getMcpInventory } from "./mcpInventory";
export { receiveWebhook, type WebhookResult } from "./webhooks";
export { ingestMcpRuntimeEvent, parseMcpEvent, type McpEventResult, type McpRuntimeOutcome } from "./mcpEvents";
export {
  listIdentitySources,
  getIdentitySource,
  createIdentitySource,
  updateIdentitySource,
  listReconciliationRuns,
  getReconciliationRun,
  startReconciliation,
  listPendingCorrelations,
  countPendingCorrelations,
  resolvePendingCorrelation,
  type ReconciliationInput,
  type CorrelationDecision,
} from "./identitySources";
export { executeConnectorWrite } from "./connectorWrites";
export {
  listDiscoveries,
  getDiscoveryCounts,
  getDiscovery,
  discoverFromIntegration,
  submitDiscovery,
  decideDiscovery,
  DISCOVERY_CAP,
  type ApplicationDiscovery,
  type DiscoveryFilter,
  type DiscoveryDecision,
  type DiscoveryRunResult,
} from "./discovery";
export { DISCOVERY_STATUSES, DISCOVERY_SOURCE_KINDS, allowedDecisions, type DiscoveryStatus, type DiscoverySourceKind } from "./discoveryRules";
