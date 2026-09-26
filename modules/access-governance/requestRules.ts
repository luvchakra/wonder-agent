import { ApiError } from "@/lib/shared/types/foundation";

/**
 * ACCESS-P0-18 — the request catalog's rules, pure (#9): which policy
 * governs an item, how risky a request is, and whether a request may be
 * submitted and with which initial status (spec §11.4, §11.5). The service
 * does the I/O; a model never decides any of this.
 */

export const RISK_LEVELS = ["low", "medium", "high", "critical"] as const;
export type RiskLevel = (typeof RISK_LEVELS)[number];
export const ALLOW_FOR_OTHERS = ["none", "managers", "access_managers"] as const;
export const APPROVAL_ROUTES = ["manager_approval", "owner_approval", "manager_and_owner"] as const;
export const APPROVAL_MODES = ["sequential", "parallel"] as const;
export const ON_TIMEOUT = ["escalate", "expire"] as const;

export type RequestPolicy = {
  id: string;
  name: string;
  applicationId: string | null;
  entitlementId: string | null;
  requestable: boolean;
  allowSelf: boolean;
  allowForOthers: (typeof ALLOW_FOR_OTHERS)[number];
  maxDurationDays: number | null;
  defaultDurationDays: number | null;
  justificationRequired: boolean;
  riskThreshold: RiskLevel;
  autoApprove: boolean;
  approval: (typeof APPROVAL_ROUTES)[number];
  /** ACCESS-P0-19: a two-party route runs in order or both at once. */
  approvalMode: (typeof APPROVAL_MODES)[number];
  /** ACCESS-P0-19: days each approver has before the step escalates or expires. */
  approvalTimeoutDays: number;
  onTimeout: (typeof ON_TIMEOUT)[number];
  status: "active" | "inactive";
};

/** With no policy at all, nothing is requestable by default: someone must decide the terms. */
export function resolvePolicy(policies: RequestPolicy[], applicationId: string, entitlementId: string | null): RequestPolicy | null {
  const active = policies.filter((p) => p.status === "active");
  return (
    (entitlementId ? active.find((p) => p.entitlementId === entitlementId) : undefined) ??
    active.find((p) => p.applicationId === applicationId && !p.entitlementId) ??
    active.find((p) => !p.applicationId && !p.entitlementId) ??
    null
  );
}

const rank = (r: RiskLevel) => RISK_LEVELS.indexOf(r);
const max = (...levels: RiskLevel[]) => levels.reduce((a, b) => (rank(b) > rank(a) ? b : a), "low" as RiskLevel);

/** The risk of granting this: the worst of the entitlement's privilege and data, and the application's risk. */
export function assessRisk(input: { privilegeLevel?: string | null; dataClassification?: string | null; appRiskLevel?: string | null; appDataClassification?: string | null }): RiskLevel {
  const priv: RiskLevel = input.privilegeLevel === "admin" ? "critical" : input.privilegeLevel === "elevated" ? "high" : "low";
  const data = (c?: string | null): RiskLevel => {
    const v = (c ?? "").toLowerCase();
    if (/restricted|secret|pii|phi|pci|financial|customer/.test(v)) return "high";
    if (/confidential/.test(v)) return "medium";
    return "low";
  };
  const app = (RISK_LEVELS as readonly string[]).includes(input.appRiskLevel ?? "") ? (input.appRiskLevel as RiskLevel) : "low";
  // An entitlement-less (application-level) request inherits the application's own classification.
  return max(priv, data(input.dataClassification ?? input.appDataClassification), app === "critical" ? "high" : app);
}

/** A person approves at or above the policy's risk threshold, or whenever the policy does not auto-approve. */
export function needsApproval(policy: Pick<RequestPolicy, "autoApprove" | "riskThreshold">, risk: RiskLevel): boolean {
  return !policy.autoApprove || rank(risk) >= rank(policy.riskThreshold);
}

/** What a request will meet: automatic approval, an approval route, or nothing (not requestable). */
export function approvalOutcome(policy: RequestPolicy | null, risk: RiskLevel): "automatic" | RequestPolicy["approval"] | null {
  if (!policy || !policy.requestable) return null;
  return needsApproval(policy, risk) ? policy.approval : "automatic";
}

export type RequestContext = {
  policy: RequestPolicy | null;
  appActive: boolean;
  risk: RiskLevel;
  requesterIdentityId: string | null;
  subject: { id: string; status: string; managerIdentityId: string | null; identityType: string };
  requesterCanManageAccess: boolean;
  durationDays: number | null;
  justification: string;
  now: Date;
};

export type RequestDecision =
  | { ok: false; status: 400 | 403 | 409; code: string; message: string }
  | {
      ok: true;
      initialStatus: "approved" | "pending";
      durationDays: number | null;
      expiresAt: string | null;
      checks: { check: string; result: string }[];
    };

const refuse = (status: 400 | 403 | 409, code: string, message: string): RequestDecision => ({ ok: false, status, code, message });

/**
 * Whether this request may be submitted, and whether it waits for approval
 * or is approved automatically. Automatic approval needs a policy that
 * allows it AND a risk below the policy's threshold; at or above the
 * threshold a person always approves (spec §11.5).
 */
export function evaluateRequest(c: RequestContext): RequestDecision {
  const checks: { check: string; result: string }[] = [];
  if (!c.appActive) return refuse(409, "NOT_REQUESTABLE", "This application is not live yet; it is requestable once onboarding is promoted");
  if (!c.policy || !c.policy.requestable) return refuse(403, "NOT_REQUESTABLE", "No request policy makes this requestable");
  checks.push({ check: "policy", result: c.policy.name });
  if (c.subject.identityType === "AI_AGENT") return refuse(400, "VALIDATION_FAILED", "An AI agent's access is requested from the agent");
  if (c.subject.status !== "active") return refuse(409, "SUBJECT_INACTIVE", "Access can only be requested for an active identity");

  const self = c.requesterIdentityId !== null && c.requesterIdentityId === c.subject.id;
  if (self) {
    if (!c.policy.allowSelf) return refuse(403, "NOT_ALLOWED", "This policy does not allow requesting for yourself");
    checks.push({ check: "for", result: "self" });
  } else {
    const isManager = c.requesterIdentityId !== null && c.subject.managerIdentityId === c.requesterIdentityId;
    const mayForOthers =
      c.policy.allowForOthers === "access_managers" ? c.requesterCanManageAccess : c.policy.allowForOthers === "managers" ? isManager || c.requesterCanManageAccess : false;
    if (!mayForOthers) {
      return refuse(
        403,
        "REQUEST_SCOPE",
        c.policy.allowForOthers === "none"
          ? "This policy allows requests only for yourself"
          : c.policy.allowForOthers === "managers"
            ? "Only the person's manager or an access manager may request this for them"
            : "Only an access manager may request this for someone else",
      );
    }
    checks.push({ check: "for", result: isManager ? "a direct report" : "someone else (access manager)" });
  }

  let duration = c.durationDays;
  if (duration !== null && (!Number.isInteger(duration) || duration < 1 || duration > 3650)) return refuse(400, "VALIDATION_FAILED", "durationDays: 1 to 3650 days");
  if (duration === null) duration = c.policy.defaultDurationDays ?? c.policy.maxDurationDays;
  if (c.policy.maxDurationDays !== null && duration !== null && duration > c.policy.maxDurationDays) {
    return refuse(400, "DURATION_TOO_LONG", `The longest this can be granted for is ${c.policy.maxDurationDays} days`);
  }
  checks.push({ check: "duration", result: duration ? `${duration} days` : "until removed" });

  const justification = c.justification.trim();
  if (c.policy.justificationRequired && justification.length < 10) return refuse(400, "JUSTIFICATION_REQUIRED", "Say why the access is needed (at least 10 characters)");

  const approval = needsApproval(c.policy, c.risk);
  checks.push({ check: "risk", result: `${c.risk} (approval required from ${c.policy.riskThreshold})` });
  checks.push({ check: "approval", result: approval ? c.policy.approval : "automatic" });
  return {
    ok: true,
    initialStatus: approval ? "pending" : "approved",
    durationDays: duration,
    expiresAt: duration ? new Date(c.now.getTime() + duration * 86_400_000).toISOString() : null,
    checks,
  };
}

/** Validates a policy's fields for create or update. */
export function validatePolicyInput(input: Record<string, unknown>, partial = false): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const has = (k: string) => Object.prototype.hasOwnProperty.call(input, k) && input[k] !== undefined;
  const fail = (m: string): never => {
    throw new ApiError(400, "VALIDATION_FAILED", m);
  };
  const flag = (v: unknown) => v === true || v === "true" || v === "on";
  const days = (k: string) => {
    const v = input[k];
    if (v === null || v === "") return null;
    const n = Number(v);
    if (!Number.isInteger(n) || n < 1 || n > 3650) fail(`${k}: 1 to 3650 days, or empty`);
    return n;
  };
  if (!partial || has("name")) {
    const n = typeof input.name === "string" ? input.name.trim() : "";
    if (!n || n.length > 200) fail("name: 1 to 200 characters");
    out.name = n;
  }
  for (const [k, col] of [["requestable", "requestable"], ["allowSelf", "allow_self"], ["justificationRequired", "justification_required"], ["autoApprove", "auto_approve"]] as const) {
    if (has(k)) out[col] = flag(input[k]);
  }
  if (has("allowForOthers")) {
    if (!(ALLOW_FOR_OTHERS as readonly unknown[]).includes(input.allowForOthers)) fail("allowForOthers: none, managers or access_managers");
    out.allow_for_others = input.allowForOthers;
  }
  if (has("riskThreshold")) {
    if (!(RISK_LEVELS as readonly unknown[]).includes(input.riskThreshold)) fail("riskThreshold: low, medium, high or critical");
    out.risk_threshold = input.riskThreshold;
  }
  if (has("approval")) {
    if (!(APPROVAL_ROUTES as readonly unknown[]).includes(input.approval)) fail("approval: manager_approval, owner_approval or manager_and_owner");
    out.approval = input.approval;
  }
  if (has("approvalMode")) {
    if (!(APPROVAL_MODES as readonly unknown[]).includes(input.approvalMode)) fail("approvalMode: sequential or parallel");
    out.approval_mode = input.approvalMode;
  }
  if (has("onTimeout")) {
    if (!(ON_TIMEOUT as readonly unknown[]).includes(input.onTimeout)) fail("onTimeout: escalate or expire");
    out.on_timeout = input.onTimeout;
  }
  if (has("approvalTimeoutDays")) {
    const n = Number(input.approvalTimeoutDays);
    if (!Number.isInteger(n) || n < 1 || n > 60) fail("approvalTimeoutDays: 1 to 60 days");
    out.approval_timeout_days = n;
  }
  if (has("maxDurationDays")) out.max_duration_days = days("maxDurationDays");
  if (has("defaultDurationDays")) out.default_duration_days = days("defaultDurationDays");
  if (typeof out.max_duration_days === "number" && typeof out.default_duration_days === "number" && out.default_duration_days > out.max_duration_days) {
    fail("defaultDurationDays: cannot exceed the maximum");
  }
  if (has("status")) {
    if (input.status !== "active" && input.status !== "inactive") fail("status: active or inactive");
    out.status = input.status;
  }
  return out;
}
