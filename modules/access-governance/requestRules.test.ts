// @vitest-environment node
import { describe, expect, it } from "vitest";
import { assessRisk, evaluateRequest, resolvePolicy, validatePolicyInput, type RequestContext, type RequestPolicy } from "./requestRules";

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
  it("high-risk requests always route to approval, whatever the policy says about auto-approval", () => {
    expect(evaluateRequest(ctx({ risk: "high" }))).toMatchObject({ ok: true, initialStatus: "pending" });
    expect(evaluateRequest(ctx({ policy: policy({ autoApprove: false }) }))).toMatchObject({ ok: true, initialStatus: "pending" });
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
  it("self-requests can be turned off; inactive people, agents and applications not yet live are refused", () => {
    expect(evaluateRequest(ctx({ policy: policy({ allowSelf: false }) }))).toMatchObject({ ok: false, code: "NOT_ALLOWED" });
    expect(evaluateRequest(ctx({ subject: { id: "me", status: "disabled", managerIdentityId: null, identityType: "HUMAN" } }))).toMatchObject({ ok: false, code: "SUBJECT_INACTIVE" });
    expect(evaluateRequest(ctx({ subject: { id: "x", status: "active", managerIdentityId: null, identityType: "AI_AGENT" } }))).toMatchObject({ ok: false, status: 400 });
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
