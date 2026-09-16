import "server-only";

/**
 * The published contract for the Operations Agent's module
 * (docs/plan/10-OPERATIONS-AGENT-BACKLOG.md). Other modules must import
 * from this file only — never query notifications/reports/
 * notification_preferences directly. `notify(event)` is the one function
 * every P0-listed trigger-producing module (Risk, Compliance, Identity,
 * Integration) is expected to call at the moment its own event occurs.
 */

export { listAuditLogs, exportAuditLogs } from "./audit";
export { toCsv } from "./csv";
export { notify, listNotifications, markNotificationRead, listNotificationPreferences, setNotificationPreference } from "./notifications";
export { search, maskRiskField } from "./search";
export {
  generateReport,
  generateAgentInventoryReport,
  generateOwnershipReport,
  generateAccessCertificationReport,
  generateRogueAgentReport,
  generateAccessViolationReport,
  generateRiskReport,
  generateAuditEvidenceReport,
  generatePolicyComplianceReport,
} from "./reports";
export { saveReportDefinition, listSavedReportDefinitions, type SaveReportDefinitionInput } from "./savedReports";
export { getJobStatusSummary } from "./jobs";
export { exportGovernanceEvidencePack } from "./evidencePackExport";
