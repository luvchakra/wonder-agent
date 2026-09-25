import type { FindingStatus, InvestigationPriority, InvestigationStatus, RiskSeverity } from "@/lib/shared/types/risk";

/**
 * RISK-P0-11 — the deterministic rules for investigations (#9), pure so
 * they are unit-tested without a database.
 */

/** Which status changes are allowed. Resolved and closed can be reopened (back to in progress). */
export const TRANSITIONS: Record<InvestigationStatus, InvestigationStatus[]> = {
  open: ["in_progress", "awaiting_remediation", "resolved", "closed"],
  in_progress: ["open", "awaiting_remediation", "resolved", "closed"],
  awaiting_remediation: ["in_progress", "resolved", "closed"],
  resolved: ["in_progress"],
  closed: ["in_progress"],
};

export function canTransition(from: InvestigationStatus, to: InvestigationStatus): boolean {
  return TRANSITIONS[from]?.includes(to) ?? false;
}

/**
 * The statuses in which a finding needs no further action: the same closed
 * set the Agents page uses. Every other status (open, acknowledged,
 * investigating, assigned, remediation in progress, and any status added
 * later) counts as still open, so a new status can never silently let an
 * investigation be resolved.
 */
export const CLOSED_FINDING_STATUSES: FindingStatus[] = ["resolved", "false_positive", "exception", "mitigated"];

export function isFindingOpen(status: FindingStatus): boolean {
  return !CLOSED_FINDING_STATUSES.includes(status);
}

/**
 * Why a status change must be refused, or null when it may proceed.
 * "Resolved" is a claim that the problem is fixed, so it is refused while
 * any grouped finding is still open (§17.5: never report success that has
 * not happened). "Closed" (no action, duplicate, out of scope) needs a
 * written reason instead.
 */
export function transitionBlocker(
  from: InvestigationStatus,
  to: InvestigationStatus,
  findingStatuses: FindingStatus[],
  reason: string | null,
): { code: string; message: string } | null {
  if (!canTransition(from, to)) return { code: "INVALID_TRANSITION", message: `An investigation cannot go from ${from} to ${to}` };
  if (to === "resolved") {
    const open = findingStatuses.filter(isFindingOpen).length;
    if (open > 0) return { code: "FINDINGS_STILL_OPEN", message: `${open} finding${open === 1 ? " is" : "s are"} still open; resolve or remediate ${open === 1 ? "it" : "them"} first` };
    if (!reason?.trim()) return { code: "RESOLUTION_REQUIRED", message: "Say how the investigation was resolved" };
  }
  if (to === "closed" && !reason?.trim()) return { code: "REASON_REQUIRED", message: "Say why the investigation is closed without resolution" };
  return null;
}

const SEVERITY_ORDER: RiskSeverity[] = ["critical", "high", "medium", "low", "info"];

/** The default priority: the worst severity among the grouped findings. */
export function priorityFromSeverities(severities: RiskSeverity[]): InvestigationPriority {
  const worst = SEVERITY_ORDER.find((s) => severities.includes(s));
  return worst === "critical" || worst === "high" || worst === "medium" ? worst : "low";
}

export function worstSeverity(severities: RiskSeverity[]): RiskSeverity | null {
  return SEVERITY_ORDER.find((s) => severities.includes(s)) ?? null;
}

/** INV-<year>-<sequence>, the sequence zero-padded to at least 3 digits. */
export function formatReference(year: number, sequence: number): string {
  return `INV-${year}-${String(sequence).padStart(3, "0")}`;
}

/** The next sequence for a year, from the references already used. */
export function nextSequence(year: number, existing: string[]): number {
  const prefix = `INV-${year}-`;
  const used = existing.filter((r) => r.startsWith(prefix)).map((r) => Number.parseInt(r.slice(prefix.length), 10)).filter(Number.isFinite);
  return (used.length ? Math.max(...used) : 0) + 1;
}
