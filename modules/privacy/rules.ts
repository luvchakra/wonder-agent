/**
 * COMPLIANCE-P0-12 — the deterministic privacy rules (non-negotiable #9):
 * statutory response deadlines, extensions, the request state machine,
 * breach-notification clocks and retention cut-offs. Pure, so every rule
 * is unit-tested and none depends on a model's judgement.
 *
 * Sources (as at October 2026):
 * - GDPR Art. 12(3): respond without undue delay and within one month of
 *   receipt; extendable by two further months where necessary, telling
 *   the subject within the first month. UK GDPR: the same.
 * - DPDP Rules 2025 Rule 14(3): grievances (and the rights requests they
 *   carry) answered within a period not exceeding 90 days; no extension.
 * - CCPA §1798.130: 45 days, extendable once by 45 days with notice.
 * - GDPR Art. 33(1): notify the supervisory authority within 72 hours of
 *   becoming aware, unless the breach is unlikely to result in a risk;
 *   Art. 34(1): tell individuals without undue delay when high risk.
 * - DPDP s.8(6) + Rule 7: intimate the Data Protection Board AND each
 *   affected Data Principal without delay, whatever the risk, and give the
 *   Board a detailed report within 72 hours of becoming aware.
 * - CCPA/Cal. Civ. Code §1798.82: notify residents "in the most expedient
 *   time possible"; tracked here as subject notice with no fixed clock.
 */

export type Regime = "gdpr" | "uk_gdpr" | "dpdp" | "ccpa";
export const REGIMES: Regime[] = ["gdpr", "uk_gdpr", "dpdp", "ccpa"];
export const REGIME_LABEL: Record<Regime, string> = { gdpr: "EU GDPR", uk_gdpr: "UK GDPR", dpdp: "India DPDP", ccpa: "California CCPA/CPRA" };

export type RequestType = "access" | "portability" | "rectification" | "erasure" | "restriction" | "objection" | "withdraw_consent" | "grievance" | "nomination" | "opt_out";
export const REQUEST_TYPE_LABEL: Record<RequestType, string> = {
  access: "Access (copy of my data)",
  portability: "Portability (machine-readable export)",
  rectification: "Correction",
  erasure: "Erasure",
  restriction: "Restrict processing",
  objection: "Object to processing",
  withdraw_consent: "Withdraw consent",
  grievance: "Grievance",
  nomination: "Nominate a representative (DPDP)",
  opt_out: "Opt out of sale/sharing (CCPA)",
};

/** Which request types each regime recognises. */
export const REGIME_REQUEST_TYPES: Record<Regime, RequestType[]> = {
  gdpr: ["access", "portability", "rectification", "erasure", "restriction", "objection", "withdraw_consent"],
  uk_gdpr: ["access", "portability", "rectification", "erasure", "restriction", "objection", "withdraw_consent"],
  dpdp: ["access", "rectification", "erasure", "withdraw_consent", "grievance", "nomination"],
  ccpa: ["access", "portability", "rectification", "erasure", "opt_out"],
};

export type RequestStatus = "received" | "identity_verification" | "in_progress" | "awaiting_approval" | "completed" | "rejected" | "withdrawn";

const DAY = 24 * 60 * 60 * 1000;

/** Adds calendar months, clamping to the month's last day (31 Jan + 1 month = 28/29 Feb), per GDPR's "one month". */
export function addMonths(at: Date, months: number): Date {
  const d = new Date(at.getTime());
  const day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + months);
  const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, last));
  return d;
}

export function responseDueAt(regime: Regime, receivedAt: Date): Date {
  switch (regime) {
    case "gdpr":
    case "uk_gdpr":
      return addMonths(receivedAt, 1);
    case "dpdp":
      return new Date(receivedAt.getTime() + 90 * DAY);
    case "ccpa":
      return new Date(receivedAt.getTime() + 45 * DAY);
  }
}

/** The latest an extension may push the deadline to, or null when the regime allows none. */
export function maxExtendedDueAt(regime: Regime, receivedAt: Date): Date | null {
  switch (regime) {
    case "gdpr":
    case "uk_gdpr":
      return addMonths(receivedAt, 3);
    case "ccpa":
      return new Date(receivedAt.getTime() + 90 * DAY);
    case "dpdp":
      return null;
  }
}

export function checkExtension(regime: Regime, receivedAt: Date, dueAt: Date, requested: Date, now: Date, alreadyExtended: boolean): string | null {
  const max = maxExtendedDueAt(regime, receivedAt);
  if (!max) return "This law allows no extension of the response deadline.";
  if (alreadyExtended) return "The deadline has already been extended once.";
  if (now > dueAt) return "The original deadline has passed; an extension must be notified within it.";
  if (requested <= dueAt) return "The new deadline must be after the current one.";
  if (requested > max) return `The deadline can be extended to ${max.toISOString().slice(0, 10)} at the latest.`;
  return null;
}

/** The request state machine. Closed states are terminal. */
export const REQUEST_TRANSITIONS: Record<RequestStatus, RequestStatus[]> = {
  received: ["identity_verification", "in_progress", "rejected", "withdrawn"],
  identity_verification: ["in_progress", "rejected", "withdrawn"],
  in_progress: ["awaiting_approval", "completed", "rejected", "withdrawn"],
  awaiting_approval: ["in_progress", "completed", "rejected", "withdrawn"],
  completed: [],
  rejected: [],
  withdrawn: [],
};

export function canTransition(from: RequestStatus, to: RequestStatus): boolean {
  return REQUEST_TRANSITIONS[from].includes(to);
}

/** Erasure is destructive: it needs a second person's approval before it runs (non-negotiable #15). */
export function requiresApproval(type: RequestType): boolean {
  return type === "erasure";
}

/** Fulfilling a request needs the subject's identity verified first (GDPR Art. 12(6); DPDP Rule 14). */
export function requiresVerification(type: RequestType): boolean {
  return type !== "grievance";
}

export type DeadlineState = "on_track" | "due_soon" | "overdue" | "closed";

export function deadlineState(status: RequestStatus, effectiveDueAt: Date, now: Date): DeadlineState {
  if (status === "completed" || status === "rejected" || status === "withdrawn") return "closed";
  if (now > effectiveDueAt) return "overdue";
  if (effectiveDueAt.getTime() - now.getTime() <= 7 * DAY) return "due_soon";
  return "on_track";
}

/** A short, human-friendly reference: PR-2026-7Q3K9D. */
export function requestReference(prefix: "PR" | "BR", at: Date, random: () => number = Math.random): string {
  const alphabet = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
  let code = "";
  for (let i = 0; i < 6; i++) code += alphabet[Math.floor(random() * alphabet.length)];
  return `${prefix}-${at.getUTCFullYear()}-${code}`;
}

// ------------------------------------------------------------- breaches

export type BreachRisk = "unlikely" | "risk" | "high_risk";

export type BreachFacts = {
  regimes: Regime[];
  riskToIndividuals: BreachRisk;
  detectedAt: Date;
  authorityNotifiedAt: Date | null;
  dpbNotifiedAt: Date | null;
  dpbReportAt: Date | null;
  subjectsNotifiedAt: Date | null;
  status: "open" | "contained" | "closed";
};

export type BreachObligation = {
  key: "authority" | "dpb_intimation" | "dpb_report" | "subjects";
  label: string;
  basis: string;
  dueAt: Date | null;
  doneAt: Date | null;
  state: "done" | "pending" | "overdue" | "not_required";
};

const HOURS_72 = 72 * 60 * 60 * 1000;

/** What each regime requires after a personal-data breach, and where each obligation stands. */
export function breachObligations(b: BreachFacts, now: Date): BreachObligation[] {
  const out: BreachObligation[] = [];
  const state = (dueAt: Date | null, doneAt: Date | null): BreachObligation["state"] => (doneAt ? "done" : dueAt && now > dueAt ? "overdue" : "pending");
  const eu = b.regimes.filter((r) => r === "gdpr" || r === "uk_gdpr");
  if (eu.length) {
    const due = new Date(b.detectedAt.getTime() + HOURS_72);
    const required = b.riskToIndividuals !== "unlikely";
    out.push({
      key: "authority",
      label: eu.includes("uk_gdpr") && !eu.includes("gdpr") ? "Notify the ICO" : "Notify the supervisory authority",
      basis: "GDPR Art. 33(1): within 72 hours of becoming aware",
      dueAt: required ? due : null,
      doneAt: b.authorityNotifiedAt,
      state: required ? state(due, b.authorityNotifiedAt) : b.authorityNotifiedAt ? "done" : "not_required",
    });
  }
  if (b.regimes.includes("dpdp")) {
    out.push({
      key: "dpb_intimation",
      label: "Intimate the Data Protection Board of India",
      basis: "DPDP s.8(6), Rule 7(2)(a): without delay",
      dueAt: b.detectedAt,
      doneAt: b.dpbNotifiedAt,
      state: b.dpbNotifiedAt ? "done" : "overdue",
    });
    const reportDue = new Date(b.detectedAt.getTime() + HOURS_72);
    out.push({
      key: "dpb_report",
      label: "Submit the detailed report to the Board",
      basis: "DPDP Rule 7(2)(b): within 72 hours of becoming aware",
      dueAt: reportDue,
      doneAt: b.dpbReportAt,
      state: state(reportDue, b.dpbReportAt),
    });
  }
  const subjectsRequired = b.regimes.includes("dpdp") || b.regimes.includes("ccpa") || (eu.length > 0 && b.riskToIndividuals === "high_risk");
  out.push({
    key: "subjects",
    label: "Notify affected individuals",
    basis: b.regimes.includes("dpdp")
      ? "DPDP s.8(6), Rule 7(1): each affected Data Principal, without delay"
      : b.regimes.includes("ccpa")
        ? "Cal. Civ. Code §1798.82: in the most expedient time possible"
        : "GDPR Art. 34(1): without undue delay where high risk",
    dueAt: subjectsRequired ? b.detectedAt : null,
    doneAt: b.subjectsNotifiedAt,
    // "Without delay" has no fixed clock; it reads as pending, not overdue, until notified.
    state: subjectsRequired ? (b.subjectsNotifiedAt ? "done" : "pending") : b.subjectsNotifiedAt ? "done" : "not_required",
  });
  return out;
}

/** A breach can only close once every required notification is recorded (or a reason for delay is given). */
export function closeBreachRefusal(b: BreachFacts, delayReason: string | null, now: Date): string | null {
  const open = breachObligations(b, now).filter((o) => o.state === "pending" || o.state === "overdue");
  if (open.length && !(delayReason && delayReason.trim().length >= 10)) {
    return `Record these before closing, or give the reason they were not made: ${open.map((o) => o.label).join("; ")}.`;
  }
  return null;
}

// ------------------------------------------------------------- retention

export type RetentionCategory = "audit_logs" | "runtime_events" | "notifications" | "closed_privacy_requests" | "withdrawn_consents" | "removed_members";

export const RETENTION_CATEGORIES: { key: RetentionCategory; label: string; minDays: number; description: string }[] = [
  { key: "audit_logs", label: "Audit trail", minDays: 365, description: "Deleted oldest-first through the hash-chain purge; never the last year (DPDP Rule 8(3)); legal holds stop it." },
  { key: "runtime_events", label: "Runtime events", minDays: 30, description: "Agent runtime activity (DID evidence) older than the period." },
  { key: "notifications", label: "Notifications", minDays: 30, description: "In-app notifications older than the period." },
  { key: "closed_privacy_requests", label: "Closed privacy requests", minDays: 365, description: "Subject details pseudonymised once the request has been closed this long; the record of the response stays." },
  { key: "withdrawn_consents", label: "Withdrawn consents", minDays: 365, description: "Subject identifier pseudonymised once withdrawn this long; the proof of the consent history stays." },
  { key: "removed_members", label: "Removed members", minDays: 30, description: "People removed from the organization this long ago have their names and emails pseudonymised in it." },
];

export function minRetentionDays(category: RetentionCategory): number {
  return RETENTION_CATEGORIES.find((c) => c.key === category)!.minDays;
}

export function retentionCutoff(now: Date, days: number): Date {
  return new Date(now.getTime() - days * DAY);
}

/** A stable pseudonym for an erased identifier: the same input maps to the same token within a tenant. */
export function pseudonymLabel(hashHex: string): string {
  return `erased-${hashHex.slice(0, 16)}`;
}
