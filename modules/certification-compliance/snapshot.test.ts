// @vitest-environment node
import { describe, expect, it } from "vitest";
import { computeUsageForApplication, computeWorstSeverity, shapeCertificationSnapshot } from "./snapshot";
import type { RiskFinding } from "@/lib/shared/types/risk";

describe("computeWorstSeverity — COMPLIANCE-P0-03", () => {
  it("returns null for no findings", () => {
    expect(computeWorstSeverity([])).toBeNull();
  });

  it("returns the single finding's severity", () => {
    expect(computeWorstSeverity([{ severity: "medium" } as Pick<RiskFinding, "severity">])).toBe("medium");
  });

  it("returns the highest-ranked severity across several findings, info counting as the lowest", () => {
    const findings = [{ severity: "info" }, { severity: "high" }, { severity: "low" }] as Pick<RiskFinding, "severity">[];
    expect(computeWorstSeverity(findings)).toBe("high");
  });
});

describe("computeUsageForApplication — COMPLIANCE-P0-03/01.2", () => {
  it("is 'unknown' when there is no DID data and no findings at all", () => {
    expect(computeUsageForApplication([], false, "Snowflake")).toBe("unknown");
  });

  it("is 'used' when a DID tuple touched this exact application", () => {
    expect(computeUsageForApplication([{ application: "Snowflake" }, { application: "SAP" }], false, "Snowflake")).toBe("used");
  });

  it("is 'never' when DID data exists but none touched this application", () => {
    expect(computeUsageForApplication([{ application: "SAP" }], false, "Snowflake")).toBe("never");
  });

  it("is 'never' (not 'unknown') when there's no DID data but findings exist", () => {
    expect(computeUsageForApplication([], true, "Snowflake")).toBe("never");
  });
});

describe("shapeCertificationSnapshot — COMPLIANCE-P0-03", () => {
  it("captures contract version, the specific grant, and policy versions", () => {
    const snapshot = shapeCertificationSnapshot({
      contract: { id: "contract-1", version: 3 } as never,
      grant: { id: "grant-1", application: "Snowflake", entitlementName: "CustomerDB_READ", dataClassification: "pii" } as never,
      policyEvaluations: [{ policyId: "policy-1", policyVersion: 2, result: "violation" } as never],
      riskAtReview: "critical",
      usageAtReview: "used",
    });

    expect(snapshot.agentContractId).toBe("contract-1");
    expect(snapshot.agentContractVersion).toBe(3);
    expect(snapshot.accessGrant).toEqual({ id: "grant-1", application: "Snowflake", entitlementName: "CustomerDB_READ", dataClassification: "pii" });
    expect(snapshot.policyEvaluations).toEqual([{ policyId: "policy-1", policyVersion: 2, result: "violation" }]);
    expect(snapshot.riskAtReview).toBe("critical");
    expect(snapshot.usageAtReview).toBe("used");
    expect(snapshot.capturedAt).toBeTruthy();
  });

  it("handles a null contract and null grant (e.g. an application-scoped item with no specific entitlement)", () => {
    const snapshot = shapeCertificationSnapshot({ contract: null, grant: null, policyEvaluations: [], riskAtReview: null, usageAtReview: "unknown" });
    expect(snapshot.agentContractId).toBeNull();
    expect(snapshot.agentContractVersion).toBeNull();
    expect(snapshot.accessGrant).toBeNull();
  });
});
