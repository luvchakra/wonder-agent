/**
 * ACCESS-P0-24 — the access ledger's rules: where one access relationship
 * came from and whether WonderID evidence stands behind it. Pure and
 * deterministic (non-negotiable #9); `ledger.ts` loads the records and
 * writes the result.
 *
 * A relationship is an account (entitlementId null: access to the
 * application itself) or one entitlement of an account. Evidence is a
 * WonderID record only: an approved request, a fulfilled access-package
 * item, or an administrator's grant recorded in the audit trail. Without
 * one the access is UNPROVEN, never filled in (spec §18, H5). ROGUE and
 * LEGACY_EXCEPTION wait for ACCESS-P0-25 and the owner's go-live cut-off.
 *
 * Status describes the authorization behind the access:
 * - VALID: current evidence;
 * - EXPIRED: the evidence's end has passed (a request's expiry, a package
 *   assignment that expired);
 * - REVOKED: the access was revoked in WonderID's records, or the package
 *   assignment that gave it was revoked;
 * - UNPROVEN: no evidence.
 */

export const LEDGER_SOURCES = [
  "WONDERID_REQUEST",
  "WONDERID_ROLE",
  "WONDERID_ACCESS_PACKAGE",
  "WONDERID_LIFECYCLE",
  "IMPORT",
  "LEGACY_MIGRATION",
  "ADMIN_ASSIGNMENT",
  "EMERGENCY_ACCESS",
  "AGENT_AUTHORIZATION",
  "UNKNOWN",
] as const;
export type LedgerSource = (typeof LEDGER_SOURCES)[number];

export const LEDGER_STATUSES = ["VALID", "EXPIRED", "REVOKED", "UNPROVEN", "ROGUE", "LEGACY_EXCEPTION", "PENDING_RECONCILIATION"] as const;
export type LedgerStatus = (typeof LEDGER_STATUSES)[number];

export type LedgerRelationship = {
  accountId: string;
  entitlementId: string | null;
  applicationId: string;
  identityId: string | null;
  agentId: string | null;
  accessGrantId: string | null;
  /** The account's or grant's integration: set when a connection or file reported it. */
  sourceIntegrationId: string | null;
  /** The account came from a reconciliation run. */
  reconciled: boolean;
  firstSeenAt: string;
  revokedAt: string | null;
  lastSeenAt: string | null;
  lastUsedAt: string | null;
  missingFromSourceAt: string | null;
};

export type RequestEvidence = {
  id: string;
  subjectIdentityId: string | null;
  agentId: string | null;
  applicationId: string;
  entitlementId: string | null;
  decidedBy: string | null;
  decidedAt: string | null;
  justification: string | null;
  requestedExpiry: string | null;
};

export type PackageEvidence = {
  assignmentId: string;
  identityId: string;
  applicationId: string;
  entitlementId: string | null;
  assignmentStatus: "provisioning" | "active" | "partially_failed" | "expired" | "revoked";
  requestId: string | null;
  assignedBy: string | null;
  startsAt: string;
  expiresAt: string | null;
  justification: string | null;
};

export type AdminGrantEvidence = { grantId: string; actorId: string | null; at: string };

export type LedgerEvidence = {
  requests: RequestEvidence[];
  packages: PackageEvidence[];
  adminGrants: Map<string, AdminGrantEvidence>;
};

export type LedgerEntry = {
  accountId: string;
  entitlementId: string | null;
  applicationId: string;
  identityId: string | null;
  accessGrantId: string | null;
  source: LedgerSource;
  status: LedgerStatus;
  requestId: string | null;
  accessPackageAssignmentId: string | null;
  sourceIntegrationId: string | null;
  approvedBy: string | null;
  approvedAt: string | null;
  businessJustification: string | null;
  startAt: string | null;
  expiryAt: string | null;
  firstSeenAt: string;
  lastVerifiedAt: string | null;
  lastUsedAt: string | null;
  missingFromSourceAt: string | null;
  evidence: { kind: "request" | "package_assignment" | "admin_grant" | "none"; id: string | null };
};

type Candidate = Pick<
  LedgerEntry,
  "source" | "status" | "requestId" | "accessPackageAssignmentId" | "approvedBy" | "approvedAt" | "businessJustification" | "startAt" | "expiryAt" | "evidence"
>;

const past = (iso: string | null, now: Date) => iso !== null && new Date(iso).getTime() <= now.getTime();

/** The request's or package item's resource covers this relationship: the same entitlement, or any of the application's for the account itself. */
function covers(rel: LedgerRelationship, applicationId: string, entitlementId: string | null): boolean {
  if (applicationId !== rel.applicationId) return false;
  return rel.entitlementId === null || entitlementId === rel.entitlementId;
}

function fromRequest(r: RequestEvidence, now: Date): Candidate {
  return {
    source: "WONDERID_REQUEST",
    status: past(r.requestedExpiry, now) ? "EXPIRED" : "VALID",
    requestId: r.id,
    accessPackageAssignmentId: null,
    approvedBy: r.decidedBy,
    approvedAt: r.decidedAt,
    businessJustification: r.justification,
    startAt: r.decidedAt,
    expiryAt: r.requestedExpiry,
    evidence: { kind: "request", id: r.id },
  };
}

function fromPackage(p: PackageEvidence, now: Date): Candidate {
  const status: LedgerStatus =
    p.assignmentStatus === "revoked" ? "REVOKED" : p.assignmentStatus === "expired" || past(p.expiresAt, now) ? "EXPIRED" : "VALID";
  return {
    source: "WONDERID_ACCESS_PACKAGE",
    status,
    requestId: p.requestId,
    accessPackageAssignmentId: p.assignmentId,
    approvedBy: p.assignedBy,
    approvedAt: p.startsAt,
    businessJustification: p.justification,
    startAt: p.startsAt,
    expiryAt: p.expiresAt,
    evidence: { kind: "package_assignment", id: p.assignmentId },
  };
}

function fromAdmin(a: AdminGrantEvidence): Candidate {
  return {
    source: "ADMIN_ASSIGNMENT",
    status: "VALID",
    requestId: null,
    accessPackageAssignmentId: null,
    approvedBy: a.actorId,
    approvedAt: a.at,
    businessJustification: null,
    startAt: a.at,
    expiryAt: null,
    evidence: { kind: "admin_grant", id: a.grantId },
  };
}

const RANK: Record<LedgerStatus, number> = { VALID: 0, EXPIRED: 1, REVOKED: 2, UNPROVEN: 3, ROGUE: 4, LEGACY_EXCEPTION: 5, PENDING_RECONCILIATION: 6 };

/** The ledger entry for one relationship. Current evidence wins over ended evidence; among equals, the latest. */
export function ledgerEntry(rel: LedgerRelationship, evidence: LedgerEvidence, now = new Date()): LedgerEntry {
  const candidates: Candidate[] = [];
  for (const r of evidence.requests) {
    const subject = (rel.identityId !== null && r.subjectIdentityId === rel.identityId) || (rel.agentId !== null && r.agentId === rel.agentId);
    if (subject && covers(rel, r.applicationId, r.entitlementId)) candidates.push(fromRequest(r, now));
  }
  for (const p of evidence.packages) {
    if (rel.identityId !== null && p.identityId === rel.identityId && covers(rel, p.applicationId, p.entitlementId)) candidates.push(fromPackage(p, now));
  }
  // An administrator's grant is evidence only for access WonderID granted, not for access a connection or file reported.
  const admin = rel.accessGrantId && rel.sourceIntegrationId === null ? evidence.adminGrants.get(rel.accessGrantId) : undefined;
  if (admin) candidates.push(fromAdmin(admin));

  candidates.sort((a, b) => RANK[a.status] - RANK[b.status] || (b.approvedAt ?? "").localeCompare(a.approvedAt ?? ""));
  const reported = rel.sourceIntegrationId !== null || rel.reconciled;
  const best: Candidate = candidates[0] ?? {
    source: reported ? "IMPORT" : "UNKNOWN",
    status: "UNPROVEN",
    requestId: null,
    accessPackageAssignmentId: null,
    approvedBy: null,
    approvedAt: null,
    businessJustification: null,
    startAt: null,
    expiryAt: null,
    evidence: { kind: "none", id: null },
  };

  return {
    accountId: rel.accountId,
    entitlementId: rel.entitlementId,
    applicationId: rel.applicationId,
    identityId: rel.identityId,
    accessGrantId: rel.accessGrantId,
    ...best,
    // Revoked in WonderID's records: whatever authorized it, the access itself has ended.
    status: rel.revokedAt !== null ? "REVOKED" : best.status,
    sourceIntegrationId: rel.sourceIntegrationId,
    firstSeenAt: rel.firstSeenAt,
    lastVerifiedAt: rel.lastSeenAt,
    lastUsedAt: rel.lastUsedAt,
    missingFromSourceAt: rel.missingFromSourceAt,
  };
}

export type LedgerEventType = "recorded" | "changed" | "missing_from_source" | "seen_again";

/** What changed between the stored entry and the new one, as history events (none when nothing a reader would care about changed). */
export function ledgerEvents(
  before: { status: LedgerStatus; source: LedgerSource; missingFromSourceAt: string | null } | null,
  after: LedgerEntry,
): { eventType: LedgerEventType; fromStatus: LedgerStatus | null; fromSource: LedgerSource | null }[] {
  if (!before) return [{ eventType: "recorded", fromStatus: null, fromSource: null }];
  const out: { eventType: LedgerEventType; fromStatus: LedgerStatus | null; fromSource: LedgerSource | null }[] = [];
  if (before.status !== after.status || before.source !== after.source) {
    out.push({ eventType: "changed", fromStatus: before.status, fromSource: before.source });
  }
  if (before.missingFromSourceAt === null && after.missingFromSourceAt !== null) {
    out.push({ eventType: "missing_from_source", fromStatus: before.status, fromSource: before.source });
  } else if (before.missingFromSourceAt !== null && after.missingFromSourceAt === null) {
    out.push({ eventType: "seen_again", fromStatus: before.status, fromSource: before.source });
  }
  return out;
}

/** Plain words for the "why does this identity have this access?" view. */
export const LEDGER_SOURCE_LABEL: Record<LedgerSource, string> = {
  WONDERID_REQUEST: "Approved request",
  WONDERID_ROLE: "Role",
  WONDERID_ACCESS_PACKAGE: "Access package",
  WONDERID_LIFECYCLE: "Lifecycle",
  IMPORT: "Reported by a connection",
  LEGACY_MIGRATION: "Legacy migration",
  ADMIN_ASSIGNMENT: "Granted by an administrator",
  EMERGENCY_ACCESS: "Emergency access",
  AGENT_AUTHORIZATION: "Agent authorization",
  UNKNOWN: "Unknown",
};

export const LEDGER_STATUS_LABEL: Record<LedgerStatus, string> = {
  VALID: "Approved",
  EXPIRED: "Approval expired",
  REVOKED: "Revoked",
  UNPROVEN: "No approval found",
  ROGUE: "Rogue",
  LEGACY_EXCEPTION: "Legacy exception",
  PENDING_RECONCILIATION: "Pending reconciliation",
};
