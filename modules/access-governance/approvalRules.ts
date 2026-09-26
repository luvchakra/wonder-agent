import { createHash } from "node:crypto";
import type { RequestPolicy, RiskLevel } from "./requestRules";

/**
 * ACCESS-P0-19 — the approval engine's rules, pure (#9, #15): who approves
 * a request and in what order, what one approval is valid for, and what a
 * decision does to the request. The service (`approvals.ts`) does the I/O.
 *
 * - The route comes from the request policy: the subject's manager, the
 *   entitlement owner (else the application's business owner), or both —
 *   in order or at once. Critical risk adds an access-manager review.
 * - A step names one person, or is open to access managers when nobody
 *   suitable is recorded, or when the person it would name is the
 *   requester or the subject (nobody approves their own access).
 * - The same approver is asked once: a later step resolving to someone an
 *   earlier stage already asks is dropped.
 * - An approval is valid only for the exact action it saw (spec §37A.27):
 *   the fingerprint covers the tenant, request, subject, resource,
 *   privilege, duration, type and policy.
 */

export type ApproverKind = "manager" | "entitlement_owner" | "application_owner" | "package_owner" | "access_managers";
export type StepStatus = "waiting" | "pending" | "approved" | "rejected" | "skipped" | "expired" | "invalidated";

export type Person = { identityId: string; userId: string | null; active: boolean } | null;

export type PlannedStep = {
  stage: number;
  approverKind: ApproverKind;
  approverIdentityId: string | null;
  approverUserId: string | null;
  reason: string | null;
};

export type ChainInput = {
  route: RequestPolicy["approval"];
  mode: RequestPolicy["approvalMode"];
  risk: RiskLevel;
  manager: Person;
  entitlementOwner: Person;
  applicationOwner: Person;
  /** ACCESS-P0-20: for a package request, its owner is "the owner". */
  packageOwner?: Person;
  isPackage?: boolean;
  requesterUserId: string;
  subjectUserId: string | null;
};

const LABEL: Record<Exclude<ApproverKind, "access_managers">, string> = {
  manager: "manager",
  entitlement_owner: "entitlement owner",
  application_owner: "application owner",
  package_owner: "package owner",
};

/** One named approver, or access managers with the reason why. */
function resolve(kind: Exclude<ApproverKind, "access_managers">, person: Person, c: ChainInput): Omit<PlannedStep, "stage"> {
  const label = LABEL[kind];
  const open = (reason: string): Omit<PlannedStep, "stage"> => ({ approverKind: "access_managers", approverIdentityId: person?.identityId ?? null, approverUserId: null, reason });
  if (!person) return open(`No ${label} is recorded: an access manager approves instead`);
  if (!person.active) return open(`The ${label} is not active: an access manager approves instead`);
  if (!person.userId) return open(`The ${label} cannot sign in to WonderID: an access manager approves instead`);
  if (person.userId === c.requesterUserId) return open(`The ${label} made this request: an access manager approves instead`);
  if (person.userId === c.subjectUserId) return open(`The ${label} is who the access is for: an access manager approves instead`);
  return { approverKind: kind, approverIdentityId: person.identityId, approverUserId: person.userId, reason: null };
}

export function planApprovalChain(c: ChainInput): PlannedStep[] {
  const manager = () => resolve("manager", c.manager, c);
  const owner = () =>
    c.isPackage
      ? resolve("package_owner", c.packageOwner ?? null, c)
      : c.entitlementOwner
        ? resolve("entitlement_owner", c.entitlementOwner, c)
        : resolve("application_owner", c.applicationOwner, c);
  const stages: Omit<PlannedStep, "stage">[][] =
    c.route === "manager_approval" ? [[manager()]] : c.route === "owner_approval" ? [[owner()]] : c.mode === "parallel" ? [[manager(), owner()]] : [[manager()], [owner()]];
  if (c.risk === "critical") stages.push([{ approverKind: "access_managers", approverIdentityId: null, approverUserId: null, reason: "Critical risk: an access manager reviews as well" }]);

  // Ask each approver once, at the earliest stage that asks them.
  const seen = new Set<string>();
  const out: PlannedStep[] = [];
  for (const steps of stages) {
    const kept = steps.filter((s) => {
      const key = s.approverUserId ?? "access_managers";
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    if (kept.length) out.push(...kept.map((s) => ({ ...s, stage: out.length ? out[out.length - 1].stage + 1 : 1 })));
  }
  return out;
}

export type FingerprintInput = {
  tenantId: string;
  requestId: string;
  subjectIdentityId: string;
  applicationId: string | null;
  entitlementId: string | null;
  privilegeLevel: string | null;
  durationDays: number | null;
  requestType: string;
  policyId: string | null;
  /** ACCESS-P0-20: a package request is an approval of the package as it is now. */
  packageId?: string | null;
  packageContents?: string | null;
};

/** What an approval is an approval of. Any change means it must be approved again. */
export function actionFingerprint(f: FingerprintInput): string {
  const base = [f.tenantId, f.requestId, f.subjectIdentityId, f.applicationId, f.entitlementId, f.privilegeLevel, f.durationDays, f.requestType, f.policyId];
  // Appended only for a package, so every earlier fingerprint stays as it was.
  const canonical = JSON.stringify(f.packageId ? [...base, f.packageId, f.packageContents ?? ""] : base);
  return createHash("sha256").update(canonical).digest("hex");
}

export type StepState = { id: string; stage: number; status: StepStatus };

/**
 * Where the chain stands: a rejection ends it; otherwise the lowest stage
 * with an undecided step is current; with none left, the request is
 * approved. Skipped steps count as done.
 */
export function chainOutcome(steps: StepState[]): { state: "rejected" } | { state: "approved" } | { state: "open"; stage: number } | { state: "expired" } {
  const live = steps.filter((s) => s.status !== "invalidated");
  if (live.some((s) => s.status === "rejected")) return { state: "rejected" };
  if (live.some((s) => s.status === "expired")) return { state: "expired" };
  const open = live.filter((s) => s.status === "waiting" || s.status === "pending");
  if (!open.length) return live.length ? { state: "approved" } : { state: "open", stage: 1 };
  return { state: "open", stage: Math.min(...open.map((s) => s.stage)) };
}

export type Actor = { userId: string; canApproveAsAccessManager: boolean };
export type ActionableStep = { id: string; stage: number; status: StepStatus; approverKind: ApproverKind; approverUserId: string | null };

/**
 * The step this person may decide now, if any: a pending step of the
 * current stage that names them, else one open to access managers when
 * they are one. Requester and subject never decide (checked separately,
 * and again in the database).
 */
export function actionableStep(steps: ActionableStep[], stage: number, actor: Actor): ActionableStep | null {
  const current = steps.filter((s) => s.stage === stage && s.status === "pending");
  return current.find((s) => s.approverUserId === actor.userId) ?? (actor.canApproveAsAccessManager ? current.find((s) => s.approverKind === "access_managers") : undefined) ?? null;
}

/** When a pending step runs out of time: escalate a named step once, else expire the request. */
export function timeoutAction(step: { approverKind: ApproverKind; escalatedAt: string | null }, onTimeout: RequestPolicy["onTimeout"]): "escalate" | "expire" {
  return onTimeout === "escalate" && step.approverKind !== "access_managers" && !step.escalatedAt ? "escalate" : "expire";
}

export function dueAt(from: Date, days: number): string {
  return new Date(from.getTime() + days * 86_400_000).toISOString();
}
