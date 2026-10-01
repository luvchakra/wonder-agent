import type { BreachRisk, Regime, RequestStatus, RequestType, RetentionCategory } from "./rules";

/** COMPLIANCE-P0-12 — the privacy programme's published shapes (migration 0103). */

export type PrivacySettings = {
  tenantId: string;
  regimes: Regime[];
  dpoName: string | null;
  dpoEmail: string | null;
  grievanceOfficerName: string | null;
  grievanceOfficerEmail: string | null;
  grievanceOfficerPhone: string | null;
  euRepresentative: string | null;
  supervisoryAuthority: string | null;
  privacyNoticeUrl: string | null;
  privacyNoticeVersion: string | null;
  significantDataFiduciary: boolean;
  updatedAt: string | null;
};

export type LawfulBasis = "consent" | "contract" | "legal_obligation" | "vital_interests" | "public_task" | "legitimate_interests" | "dpdp_consent" | "dpdp_legitimate_use";
export type TransferMechanism = "none" | "adequacy" | "sccs" | "bcrs" | "derogation" | "dpdp_permitted";

export type ProcessingActivity = {
  id: string;
  name: string;
  purpose: string;
  lawfulBasis: LawfulBasis;
  dataCategories: string[];
  specialCategories: boolean;
  subjectCategories: string[];
  recipients: string[];
  transferCountries: string[];
  transferMechanism: TransferMechanism;
  retentionDays: number | null;
  securityMeasures: string | null;
  dpiaRequired: boolean;
  dpiaCompletedAt: string | null;
  status: "active" | "retired";
  updatedAt: string;
};

export type ConsentPurpose = { id: string; key: string; title: string; description: string; noticeVersion: string; active: boolean };

export type ConsentRecord = {
  id: string;
  purposeId: string;
  subjectUserId: string | null;
  subjectIdentifier: string;
  noticeVersion: string;
  language: string;
  channel: string;
  status: "granted" | "withdrawn";
  grantedAt: string;
  withdrawnAt: string | null;
};

export type PrivacyRequest = {
  id: string;
  reference: string;
  regime: Regime;
  requestType: RequestType;
  subjectUserId: string | null;
  subjectEmail: string;
  subjectName: string | null;
  description: string | null;
  channel: string;
  status: RequestStatus;
  receivedAt: string;
  dueAt: string;
  extendedDueAt: string | null;
  extensionReason: string | null;
  identityVerifiedAt: string | null;
  verificationMethod: string | null;
  assignedTo: string | null;
  outcome: "fulfilled" | "partially_fulfilled" | "refused" | null;
  outcomeReason: string | null;
  processedBy: string | null;
  approvedBy: string | null;
  completedAt: string | null;
  result: Record<string, unknown>;
  createdAt: string;
};

export type RetentionPolicy = {
  id: string;
  dataCategory: RetentionCategory;
  retentionDays: number;
  enabled: boolean;
  lastRunAt: string | null;
  lastRunAffected: number | null;
};

export type LegalHold = { id: string; name: string; reason: string; dataCategories: RetentionCategory[]; placedBy: string; placedAt: string; releasedAt: string | null };

export type BreachIncident = {
  id: string;
  reference: string;
  title: string;
  description: string;
  severity: "low" | "medium" | "high" | "critical";
  riskToIndividuals: BreachRisk;
  regimes: Regime[];
  dataCategories: string[];
  subjectsAffected: number | null;
  occurredAt: string | null;
  detectedAt: string;
  containedAt: string | null;
  authorityNotifiedAt: string | null;
  authorityReference: string | null;
  dpbNotifiedAt: string | null;
  dpbReportAt: string | null;
  subjectsNotifiedAt: string | null;
  delayReason: string | null;
  rootCause: string | null;
  remediation: string | null;
  status: "open" | "contained" | "closed";
  closedAt: string | null;
  createdAt: string;
};
