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
 * the connector framework's receiving side).
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
export { discoverMcpTools } from "./mcpTools";
export { getMcpInventory } from "./mcpInventory";
export { rotateReceiverSecret, getReceiverStatus } from "./framework/receive";
export { listConnectorTraffic, purgeConnectorTraffic, TRAFFIC_PAGE_SIZE, type ConnectionTraffic } from "./gateway/traffic";
export { importFileForObject, type FileImportResult } from "./fileImports";
export { IMPORT_KINDS, INLINE_SYNC_MAX_ROWS, MAX_IMPORT_BYTES, FileImportInvalidError, checkImportForm, tooLargeForImport, type ImportKind } from "./fileImportRules";
export { latestConnectorFile, type ConnectorFileInfo } from "./framework/files";
export { setConnectionSchedule, getConnectionSchedule, runScheduledSyncs, type ScheduledRunSummary } from "./connectorSchedules";
export { CONNECTION_SCHEDULES, type ConnectionSchedule } from "./connectorScheduleRules";
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
export {
  createOnboardingProposal,
  listOnboardingProposals,
  applyOnboardingProposal,
  dismissOnboardingProposal,
  type StoredProposal,
} from "./onboardingProposals";
