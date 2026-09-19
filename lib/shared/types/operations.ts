/**
 * Shared contracts owned by the Operations Agent
 * (docs/plan/10-OPERATIONS-AGENT-BACKLOG.md). Other modules import these
 * instead of redefining audit/notification/search/report shapes, and must
 * read/write operations data only through modules/operations/service.ts —
 * never by querying notifications/reports/notification_preferences
 * directly.
 */

export type AuditLogEntry = {
  id: string;
  tenantId: string;
  actorId: string | null;
  actorType: "user" | "system" | "integration";
  action: string;
  objectType: string;
  objectId: string;
  outcome: "success" | "failure";
  metadata: Record<string, unknown>;
  correlationId: string;
  createdAt: string;
};

export type AuditLogFilter = {
  objectType?: string;
  action?: string;
  actorId?: string;
  from?: string;
  to?: string;
};

export type AuditLogPage = {
  entries: AuditLogEntry[];
  nextCursor: string | null;
};

export type NotificationType =
  | "certification_due"
  | "certification_overdue"
  | "critical_finding"
  | "rogue_agent"
  | "ownership_missing"
  | "integration_failure"
  | "lifecycle_expiry";

/** The seven P0 notification types are always mandatory — never suppressible via preferences (OPERATIONS-P0-05.1). */
export const MANDATORY_NOTIFICATION_TYPES: NotificationType[] = [
  "certification_due",
  "certification_overdue",
  "critical_finding",
  "rogue_agent",
  "ownership_missing",
  "integration_failure",
  "lifecycle_expiry",
];

export type Notification = {
  id: string;
  tenantId: string;
  userId: string | null;
  type: NotificationType;
  title: string;
  body: string;
  referenceType: string | null;
  referenceId: string | null;
  readAt: string | null;
  createdAt: string;
};

export type NotifyEvent = {
  tenantId: string;
  userId?: string | null;
  type: NotificationType;
  title: string;
  body: string;
  referenceType?: string;
  referenceId?: string;
};

export type NotificationPreference = {
  tenantId: string;
  userId: string;
  type: NotificationType;
  inAppEnabled: boolean;
  emailEnabled: boolean;
  updatedAt: string;
};

export type SearchObjectType =
  | "agent"
  | "application"
  | "finding"
  | "certification_campaign"
  | "policy"
  | "integration"
  | "identity"
  | "owner"
  | "entitlement";

/**
 * OPERATIONS-P0-03.1/03.2. `riskSeverity`/`riskMasked` are present only on
 * result types that carry a risk-adjacent signal (`agent`, `finding`) —
 * `riskMasked: true` means the caller lacks `risk.read` and the field was
 * deliberately withheld, distinct from `riskSeverity: null` meaning "no
 * open finding" for a caller who *can* see it.
 */
export type SearchResult = {
  objectType: SearchObjectType;
  id: string;
  title: string;
  subtitle: string | null;
  href: string;
  freshness: string;
  riskSeverity?: string | null;
  riskMasked?: boolean;
};

export type ReportType =
  | "agent_inventory"
  | "ownership"
  | "access_certification"
  | "rogue_agent"
  | "access_violation"
  | "risk"
  | "audit_evidence"
  | "policy_compliance";

export type ReportRow = {
  id: string;
  href: string;
  fields: Record<string, unknown>;
};

/** OPERATIONS-P0-04.1/04.2 — computed live at generation time, never cached. */
export type ReportOutput = {
  reportType: ReportType;
  generatedAt: string;
  recordCount: number;
  rows: ReportRow[];
};

export type SavedReportDefinition = {
  id: string;
  tenantId: string;
  reportType: ReportType;
  name: string;
  filters: Record<string, unknown>;
  createdBy: string;
  createdAt: string;
};

/** OPERATIONS-P0-06.1 — per-integration sync/job health, tenant-wide. */
export type JobStatusSummary = {
  integrationId: string;
  integrationName: string;
  lastSuccessfulAt: string | null;
  lastRunStatus: string | null;
  lastRunAt: string | null;
  failureCountLast30Days: number;
  totalRetries: number;
};

/**
 * OPERATIONS-P0-07 — the result of turning Compliance's assembled
 * GovernanceEvidencePack into a downloadable file. `contentHash` is a
 * SHA-256 over the pack's canonical JSON (same tamper-evidence pattern as
 * COMPLIANCE-P0-06's EvidenceExportPackage), computed once regardless of
 * output format so a JSON, CSV and PDF export of the same pack all share
 * the same hash.
 */
export type EvidencePackFormat = "json" | "csv" | "pdf";

export type EvidencePackExportResult = {
  /** A rendered PDF's bytes; string for the "json"/"csv" formats. */
  content: string | Uint8Array;
  contentType: string;
  filename: string;
  contentHash: string;
};
