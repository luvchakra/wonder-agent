import { describe, expect, it } from "vitest";
import { remediationLabel, remediationPlan } from "./accessRemediationRules";

const finding = { category: "rogue_access", status: "open" as const, identityId: "id-1", applicationId: "app-1", entitlementId: "ent-1" };

describe("rogue access remediation rules (RISK-P0-13)", () => {
  it("removes rogue access to an entitlement, and disables an account nothing approved", () => {
    expect(remediationPlan(finding, null)).toEqual({ ok: true, requestType: "remove", subjectIdentityId: "id-1", applicationId: "app-1", entitlementId: "ent-1" });
    expect(remediationPlan({ ...finding, entitlementId: null }, null)).toMatchObject({ ok: true, requestType: "disable_account", entitlementId: null });
  });

  it("refuses other findings, closed findings, unlinked accounts and a second live request", () => {
    expect(remediationPlan({ ...finding, category: "excessive_access" }, null)).toMatchObject({ ok: false, code: "NOT_ACCESS_FINDING" });
    expect(remediationPlan({ ...finding, status: "resolved" }, null)).toMatchObject({ ok: false, code: "FINDING_CLOSED" });
    expect(remediationPlan({ ...finding, status: "false_positive" }, null)).toMatchObject({ ok: false, code: "FINDING_CLOSED" });
    expect(remediationPlan({ ...finding, identityId: null }, null)).toMatchObject({ ok: false, code: "ACCOUNT_UNLINKED" });
    expect(remediationPlan({ ...finding, applicationId: null }, null)).toMatchObject({ ok: false, code: "NO_APPLICATION" });
    expect(remediationPlan({ ...finding, status: "remediation_in_progress" }, "pending")).toMatchObject({ ok: false, code: "ALREADY_REQUESTED" });
    expect(remediationPlan({ ...finding, status: "remediation_in_progress" }, "approved")).toMatchObject({ ok: false, code: "ALREADY_REQUESTED" });
  });

  it("may ask again after a request ended without a change", () => {
    for (const s of ["rejected", "cancelled", "expired"]) expect(remediationPlan({ ...finding, status: "remediation_in_progress" }, s).ok).toBe(true);
  });

  it("labels where the removal stands, never claiming it is done before verification", () => {
    expect(remediationLabel(null)).toBeNull();
    expect(remediationLabel("pending")).toBe("Removal awaiting approval");
    expect(remediationLabel("fulfilled")).toBe("Removal done, awaiting verification");
    expect(remediationLabel("rejected")).toBe("Removal rejected");
  });
});
