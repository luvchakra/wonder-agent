// @vitest-environment node
import { describe, expect, it } from "vitest";
import { assessRisk, entitlementRequestability, evaluateRequest, resolvePolicy, validatePolicyInput, type RequestContext, type RequestPolicy } from "./requestRules";

const policy = (over: Partial<RequestPolicy> = {}): RequestPolicy => ({
  id: "p",
  name: "Standard",
  applicationId: null,
  entitlementId: null,
  requestable: true,
  allowSelf: true,
  allowForOthers: "managers",
  maxDurationDays: 90,
  defaultDurationDays: 30,
  justificationRequired: true,
  riskThreshold: "high",
  autoApprove: true,
  approval: "manager_approval",
  approvalMode: "sequential",
  approvalTimeoutDays: 5,
  onTimeout: "escalate",
  status: "active",
  ...over,
});

const now = new Date("2026-09-26T00:00:00Z");
const ctx = (over: Partial<RequestContext> = {}): RequestContext => ({
  policy: policy(),
  appActive: true,
  risk: "low",
  requesterIdentityId: "me",
  subject: { id: "me", status: "active", managerIdentityId: "boss", identityType: "HUMAN" },
  requesterCanManageAccess: false,
  durationDays: null,
  justification: "Quarter-end reporting",
  now,
  ...over,
});

describe("resolvePolicy", () => {
  const tenant = policy({ id: "t" });
  const app = policy({ id: "a", applicationId: "A" });
  const ent = policy({ id: "e", applicationId: "A", entitlementId: "E" });
  it("the most specific active policy applies", () => {
    expect(resolvePolicy([tenant, app, ent], "A", "E")?.id).toBe("e");
    expect(resolvePolicy([tenant, app, ent], "A", "OTHER")?.id).toBe("a");
    expect(resolvePolicy([tenant, app], "B", null)?.id).toBe("t");
    expect(resolvePolicy([tenant, { ...ent, status: "inactive" }], "A", "E")?.id).toBe("t");
  });
  it("no policy means nothing is requestable", () => {
    expect(resolvePolicy([], "A", null)).toBeNull();
    expect(evaluateRequest(ctx({ policy: null }))).toMatchObject({ ok: false, code: "NOT_REQUESTABLE" });
  });
});

describe("assessRisk", () => {
  it("takes the worst of privilege, data and the application", () => {
    expect(assessRisk({ privilegeLevel: "standard", dataClassification: "internal" })).toBe("low");
    expect(assessRisk({ privilegeLevel: "admin" })).toBe("critical");
    expect(assessRisk({ privilegeLevel: "standard", dataClassification: "customer_data" })).toBe("high");
    expect(assessRisk({ dataClassification: "confidential", appRiskLevel: "medium" })).toBe("medium");
    expect(assessRisk({ appRiskLevel: "critical" })).toBe("high");
    expect(assessRisk({ appDataClassification: "restricted" })).toBe("high");
  });
});

describe("evaluateRequest (spec §11.5)", () => {
  it("self, low risk, auto-approve policy: approved with the default duration", () => {
    const r = evaluateRequest(ctx());
    expect(r).toMatchObject({ ok: true, initialStatus: "approved", durationDays: 30, expiresAt: "2026-10-26T00:00:00.000Z" });
  });
  it("requests at or above the policy's risk threshold, or under a policy without auto-approval, route to approval", () => {
    expect(evaluateRequest(ctx({ risk: "high" }))).toMatchObject({ ok: true, initialStatus: "pending" });
    expect(evaluateRequest(ctx({ policy: policy({ autoApprove: false }) }))).toMatchObject({ ok: true, initialStatus: "pending" });
  });
  it("WID-C01 (owner decision): high and critical risk always need a person, even under a policy whose threshold is critical", () => {
    expect(evaluateRequest(ctx({ risk: "high", policy: policy({ riskThreshold: "critical" }) }))).toMatchObject({ ok: true, initialStatus: "pending" });
    expect(evaluateRequest(ctx({ risk: "critical", policy: policy({ riskThreshold: "critical" }) }))).toMatchObject({ ok: true, initialStatus: "pending" });
    expect(evaluateRequest(ctx({ risk: "medium", policy: policy({ riskThreshold: "critical" }) }))).toMatchObject({ ok: true, initialStatus: "approved" });
  });
  it("missing justification blocks submission where required", () => {
    expect(evaluateRequest(ctx({ justification: " short " }))).toMatchObject({ ok: false, code: "JUSTIFICATION_REQUIRED" });
    expect(evaluateRequest(ctx({ justification: "", policy: policy({ justificationRequired: false }) }))).toMatchObject({ ok: true });
  });
  it("durations are bounded by the policy", () => {
    expect(evaluateRequest(ctx({ durationDays: 120 }))).toMatchObject({ ok: false, code: "DURATION_TOO_LONG" });
    expect(evaluateRequest(ctx({ durationDays: 0 }))).toMatchObject({ ok: false, code: "VALIDATION_FAILED" });
    expect(evaluateRequest(ctx({ policy: policy({ maxDurationDays: null, defaultDurationDays: null }) }))).toMatchObject({ ok: true, durationDays: null, expiresAt: null });
  });
  it("requesting for someone else needs the right scope", () => {
    const other = { id: "ana", status: "active", managerIdentityId: "me", identityType: "HUMAN" };
    expect(evaluateRequest(ctx({ subject: other }))).toMatchObject({ ok: true });
    expect(evaluateRequest(ctx({ subject: { ...other, managerIdentityId: "someone" } }))).toMatchObject({ ok: false, code: "REQUEST_SCOPE" });
    expect(evaluateRequest(ctx({ subject: { ...other, managerIdentityId: "someone" }, requesterCanManageAccess: true }))).toMatchObject({ ok: true });
    expect(evaluateRequest(ctx({ subject: other, policy: policy({ allowForOthers: "none" }) }))).toMatchObject({ ok: false, code: "REQUEST_SCOPE" });
    expect(evaluateRequest(ctx({ subject: other, policy: policy({ allowForOthers: "access_managers" }) }))).toMatchObject({ ok: false, code: "REQUEST_SCOPE" });
    // Without a person identity, the requester is never "self" and never a manager.
    expect(evaluateRequest(ctx({ requesterIdentityId: null }))).toMatchObject({ ok: false, code: "REQUEST_SCOPE" });
  });
  it("IDENTITY-P0-20: a non-human identity with no owner cannot be a request's subject; with an owner it can", () => {
    const svc = { id: "svc", status: "active", managerIdentityId: null, identityType: "SERVICE_ACCOUNT" };
    const manager = { requesterCanManageAccess: true, policy: policy({ allowForOthers: "access_managers" }) };
    expect(evaluateRequest(ctx({ ...manager, subject: { ...svc, ownerIdentityId: null } }))).toMatchObject({ ok: false, status: 409, code: "SUBJECT_UNOWNED" });
    expect(evaluateRequest(ctx({ ...manager, subject: { ...svc, ownerIdentityId: "owner-1" } })).ok).toBe(true);
    // People never need an owner.
    expect(evaluateRequest(ctx({ subject: { id: "me", status: "active", managerIdentityId: null, identityType: "HUMAN" } })).ok).toBe(true);
  });
  it("ACCESS-P0-31: the owner of a service account requests for it; someone who does not own it is refused", () => {
    const svc = { id: "svc", status: "active", managerIdentityId: null, identityType: "SERVICE_ACCOUNT", ownerIdentityId: "me" };
    const owner = evaluateRequest(ctx({ subject: svc, requesterOwnsSubject: true }));
    expect(owner).toMatchObject({ ok: true });
    expect(owner.ok && owner.checks).toContainEqual({ check: "for", result: "an identity you own" });
    expect(evaluateRequest(ctx({ subject: { ...svc, ownerIdentityId: "someone" }, requesterOwnsSubject: false }))).toMatchObject({ ok: false, code: "REQUEST_SCOPE" });
    // A policy that allows requests only for yourself, or only by access managers, still applies to owners.
    expect(evaluateRequest(ctx({ subject: svc, requesterOwnsSubject: true, policy: policy({ allowForOthers: "none" }) }))).toMatchObject({ ok: false, code: "REQUEST_SCOPE" });
    expect(evaluateRequest(ctx({ subject: svc, requesterOwnsSubject: true, policy: policy({ allowForOthers: "access_managers" }) }))).toMatchObject({ ok: false, code: "REQUEST_SCOPE" });
    // Owning a person is not a thing: the flag never makes someone else's request "for a person you own".
    expect(evaluateRequest(ctx({ subject: { id: "p", status: "active", managerIdentityId: null, identityType: "HUMAN" }, requesterOwnsSubject: true }))).toMatchObject({ ok: false, code: "REQUEST_SCOPE" });
  });
  it("ACCESS-P0-31: an agent's business owner requests only what the agent's contract approves", () => {
    const agent = { id: "ag", status: "active", managerIdentityId: null, identityType: "AI_AGENT" };
    const within = evaluateRequest(ctx({ subject: agent, requesterOwnsSubject: true, agentContract: "within" }));
    expect(within).toMatchObject({ ok: true });
    expect(within.ok && within.checks).toContainEqual({ check: "contract", result: "within the agent's contract" });
    expect(evaluateRequest(ctx({ subject: agent, requesterOwnsSubject: true, agentContract: "outside" }))).toMatchObject({ ok: false, status: 403, code: "OUT_OF_CONTRACT" });
    expect(evaluateRequest(ctx({ subject: agent, requesterOwnsSubject: true, agentContract: "none" }))).toMatchObject({ ok: false, status: 409, code: "NO_ACTIVE_CONTRACT" });
    expect(evaluateRequest(ctx({ subject: agent, requesterOwnsSubject: true }))).toMatchObject({ ok: false, code: "OUT_OF_CONTRACT" });
    // An access manager who is not the business owner is refused, whatever the contract says.
    expect(evaluateRequest(ctx({ subject: agent, requesterCanManageAccess: true, agentContract: "within" }))).toMatchObject({ ok: false, code: "REQUEST_SCOPE" });
  });
  it("self-requests can be turned off; inactive people, agents and applications not yet live are refused", () => {
    expect(evaluateRequest(ctx({ policy: policy({ allowSelf: false }) }))).toMatchObject({ ok: false, code: "NOT_ALLOWED" });
    expect(evaluateRequest(ctx({ subject: { id: "me", status: "disabled", managerIdentityId: null, identityType: "HUMAN" } }))).toMatchObject({ ok: false, code: "SUBJECT_INACTIVE" });
    expect(evaluateRequest(ctx({ subject: { id: "x", status: "active", managerIdentityId: null, identityType: "AI_AGENT" } }))).toMatchObject({ ok: false, code: "REQUEST_SCOPE" });
    expect(evaluateRequest(ctx({ appActive: false }))).toMatchObject({ ok: false, code: "NOT_REQUESTABLE" });
    expect(evaluateRequest(ctx({ policy: policy({ requestable: false }) }))).toMatchObject({ ok: false, code: "NOT_REQUESTABLE" });
  });
});

describe("validatePolicyInput", () => {
  it("maps and validates fields", () => {
    expect(validatePolicyInput({ name: " Finance ", autoApprove: "on", riskThreshold: "medium", maxDurationDays: "90", defaultDurationDays: "" })).toEqual({
      name: "Finance",
      auto_approve: true,
      risk_threshold: "medium",
      max_duration_days: 90,
      default_duration_days: null,
    });
    expect(() => validatePolicyInput({ name: "" })).toThrow(/name/);
    expect(() => validatePolicyInput({ name: "x", allowForOthers: "everyone" })).toThrow(/allowForOthers/);
    expect(() => validatePolicyInput({ name: "x", maxDurationDays: 10, defaultDurationDays: 20 })).toThrow(/exceed/);
    expect(validatePolicyInput({ status: "inactive" }, true)).toEqual({ status: "inactive" });
  });
});

describe("entitlementRequestability (owner feedback 2026-10-14)", () => {
  const allows = (requestable: boolean) => policy({ requestable });
  it("is requestable only when a policy allows it and the entitlement does, and says why not", () => {
    expect(entitlementRequestability(null, true)).toEqual({ requestable: false, reason: "no_policy" });
    expect(entitlementRequestability(allows(false), true)).toEqual({ requestable: false, reason: "policy" });
    expect(entitlementRequestability(allows(true), false)).toEqual({ requestable: false, reason: "entitlement" });
    expect(entitlementRequestability(allows(true), true)).toEqual({ requestable: true, reason: null });
  });
});
