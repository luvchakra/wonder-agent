import { describe, expect, it } from "vitest";
import { validateApplicationInput } from "./applicationCatalogRules";

const err = (fn: () => unknown) => {
  try {
    fn();
  } catch (e) {
    return (e as Error).message;
  }
  return null;
};

describe("validateApplicationInput", () => {
  it("registers with defaults and trims text", () => {
    expect(validateApplicationInput({ name: "  Snowflake " }, { partial: false })).toEqual({
      name: "Snowflake",
      display_name: null,
      description: null,
      category: null,
      app_type: "other",
      vendor: null,
      url: null,
      business_owner_identity_id: null,
      technical_owner_identity_id: null,
      environment: "production",
      risk_level: null,
      criticality: null,
      data_classification: null,
      is_external: false,
    });
  });

  it("requires a name on registration, not on update", () => {
    expect(err(() => validateApplicationInput({}, { partial: false }))).toMatch(/name: required/);
    expect(validateApplicationInput({ riskLevel: "high" }, { partial: true })).toEqual({ risk_level: "high" });
  });

  it("refuses unknown enumerations and non-https addresses", () => {
    expect(err(() => validateApplicationInput({ name: "x", appType: "mainframe" }, { partial: false }))).toMatch(/appType/);
    expect(err(() => validateApplicationInput({ riskLevel: "extreme" }, { partial: true }))).toMatch(/riskLevel/);
    expect(err(() => validateApplicationInput({ url: "http://example.com" }, { partial: true }))).toMatch(/https/);
    expect(err(() => validateApplicationInput({ url: "javascript:alert(1)" }, { partial: true }))).toMatch(/https/);
    expect(validateApplicationInput({ url: "https://app.example.com/login" }, { partial: true })).toEqual({ url: "https://app.example.com/login" });
  });

  it("checks owner ids and clears them when blank", () => {
    expect(err(() => validateApplicationInput({ businessOwnerIdentityId: "nope" }, { partial: true }))).toMatch(/identity id/);
    expect(validateApplicationInput({ technicalOwnerIdentityId: "" }, { partial: true })).toEqual({ technical_owner_identity_id: null });
  });

  it("never takes the tenant, onboarding status, discovery source or integration from input", () => {
    const row = validateApplicationInput(
      { name: "x", tenantId: "t", onboardingStatus: "ACTIVE", onboarding_status: "ACTIVE", discoverySource: "idp", sourceIntegrationId: "i" },
      { partial: false },
    );
    for (const k of ["tenant_id", "tenantId", "onboarding_status", "discovery_source", "source_integration_id"]) expect(row).not.toHaveProperty(k);
  });
});
