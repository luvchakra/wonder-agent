// @vitest-environment node
import { describe, expect, it } from "vitest";
import { EMPTY_CONFIG, blockReason, configHash, evaluateChecklist, simulateOnboarding, validateOnboardingConfig, type OnboardingConfig, type OnboardingState } from "./onboardingRules";

const INT = "11111111-1111-4111-8111-111111111111";
const full: OnboardingConfig = validateOnboardingConfig({
  integrationId: INT,
  accountIdentifierField: "login",
  correlationAccountField: "mail",
  correlationIdentityField: "email",
  entitlementSource: "connector",
  createAccount: true,
  updateAccount: true,
  disableAccount: true,
  deleteAccount: true,
  grantAccess: true,
  revokeAccess: true,
  requestPolicy: "manager_approval",
  certificationPolicy: "quarterly",
});
const app = { businessOwnerIdentityId: "b", technicalOwnerIdentityId: "t", riskLevel: "high", dataClassification: "confidential" };
const allCaps = { createAccount: true, updateAccount: true, disableAccount: true, deleteAccount: true, grantAccess: true, revokeAccess: true };

const err = (fn: () => unknown) => {
  try {
    fn();
  } catch (e) {
    return (e as Error).message;
  }
  return null;
};

describe("configuration", () => {
  it("validates and merges; connector entitlements need an integration", () => {
    expect(full.correlation).toEqual({ accountField: "mail", identityField: "email" });
    expect(err(() => validateOnboardingConfig({ requestPolicy: "anyone" }))).toMatch(/requestPolicy/);
    expect(err(() => validateOnboardingConfig({ accountIdentifierField: "bad field!" }))).toMatch(/accountIdentifierField/);
    expect(err(() => validateOnboardingConfig({ entitlementSource: "connector" }))).toMatch(/need an integration/);
    expect(validateOnboardingConfig({ certificationPolicy: "annual" }, full).certificationPolicy).toBe("annual");
    expect(validateOnboardingConfig({}, full)).toEqual(full);
  });

  it("hashes stably regardless of key order, and differently for any change", () => {
    const reordered = JSON.parse(JSON.stringify({ ...full, operations: { ...full.operations } }));
    expect(configHash(reordered)).toBe(configHash(full));
    expect(configHash({ ...full, requestPolicy: "owner_approval" })).not.toBe(configHash(full));
  });
});

describe("checklist (spec §8.5)", () => {
  it("passes a complete, connected, automation-ready onboarding", () => {
    const r = evaluateChecklist({ config: full, app, integration: { capabilities: allCaps, lastSyncStatus: "succeeded" }, entitlementCount: 4 });
    expect(r.blockingFailures).toEqual([]);
    expect(r.automationReady).toBe(true);
    expect(r.items).toHaveLength(15);
  });

  it("a missing account identifier stops promotion (spec §8.6)", () => {
    const r = evaluateChecklist({ config: { ...full, accountIdentifierField: null }, app, integration: { capabilities: allCaps, lastSyncStatus: "succeeded" }, entitlementCount: 4 });
    expect(r.blockingFailures).toContain("account_schema");
  });

  it("a deprovision the connector cannot do is not automation ready, but does not block (spec §8.6)", () => {
    const r = evaluateChecklist({ config: full, app, integration: { capabilities: { ...allCaps, disableAccount: false }, lastSyncStatus: "succeeded" }, entitlementCount: 4 });
    expect(r.automationReady).toBe(false);
    expect(r.blockingFailures).toEqual([]);
    expect(r.items.find((i) => i.key === "disable_delete_account")?.state).toBe("fail");
  });

  it("requires owners, classification, policies, provenance and a clean sync", () => {
    const r = evaluateChecklist({
      config: { ...full, provenanceEnabled: false, requestPolicy: null },
      app: { ...app, technicalOwnerIdentityId: null, dataClassification: null },
      integration: { capabilities: allCaps, lastSyncStatus: "partial" },
      entitlementCount: 0,
    });
    expect(r.blockingFailures.sort()).toEqual(["entitlement_model", "owner", "provenance", "reconciliation", "request_policy", "risk"].sort());
  });

  it("treats reconciliation and operations as not applicable for a manual application", () => {
    const manual = validateOnboardingConfig({ ...{}, accountIdentifierField: "id", correlationAccountField: "email", correlationIdentityField: "email", entitlementSource: "manual", requestPolicy: "owner_approval", certificationPolicy: "annual" });
    const r = evaluateChecklist({ config: manual, app, integration: null, entitlementCount: 2 });
    expect(r.blockingFailures).toEqual([]);
    expect(r.items.find((i) => i.key === "reconciliation")?.state).toBe("not_applicable");
    expect(r.automationReady).toBe(false);
  });
});

describe("simulation (spec §8.6)", () => {
  const identities = [
    { id: "i1", email: "ada@example.test", username: "ada", displayName: "Ada" },
    { id: "i2", email: "twin@example.test", username: "t1", displayName: "Twin" },
    { id: "i3", email: "twin@example.test", username: "t2", displayName: "Twin" },
  ];
  it("counts correlated, unmatched and ambiguous accounts and passes", () => {
    const r = simulateOnboarding(full, [{ login: "a1", mail: "ADA@example.test" }, { login: "a2", mail: "nobody@example.test" }, { login: "a3", mail: "twin@example.test" }], identities, 3);
    expect(r).toMatchObject({ accounts: 3, correlated: 1, unmatched: 1, ambiguous: 1, missingIdentifier: 0, passed: true });
  });
  it("fails when accounts lack the required identifier", () => {
    const r = simulateOnboarding(full, [{ mail: "ada@example.test" }], identities, 3);
    expect(r).toMatchObject({ missingIdentifier: 1, passed: false });
  });
  it("never mutates its inputs", () => {
    const accounts = [{ login: "a1", mail: "ada@example.test" }];
    const before = JSON.stringify([full, accounts, identities]);
    simulateOnboarding(full, accounts, identities, 1);
    expect(JSON.stringify([full, accounts, identities])).toBe(before);
  });
});

describe("stages", () => {
  const h = configHash(full);
  const base: OnboardingState = { status: "WAITING_FOR_APPROVAL", configHash: h, validatedHash: h, validationPassed: true, simulatedHash: h, simulationPassed: true, submittedBy: "u1", approvedHash: null };

  it("needs a current, passing validation before simulating", () => {
    expect(blockReason("simulate", { ...base, status: "VALIDATING", validatedHash: "old" }, "u1")).toMatch(/Validate/);
    expect(blockReason("simulate", { ...base, status: "VALIDATING", validationPassed: false }, "u1")).toMatch(/Validate/);
    expect(blockReason("simulate", { ...base, status: "VALIDATING" }, "u1")).toBeNull();
  });

  it("four-eyes approval, and a changed configuration invalidates the submission (spec §8.6)", () => {
    expect(blockReason("approve", base, "u1")).toMatch(/other than the submitter/);
    expect(blockReason("approve", base, "u2")).toBeNull();
    expect(blockReason("approve", { ...base, configHash: "changed" }, "u2")).toMatch(/changed/);
    expect(blockReason("reject", base, "u1")).toBeNull();
  });

  it("promotes exactly the approved version", () => {
    expect(blockReason("promote", { ...base, status: "APPROVED", approvedHash: h }, "u2")).toBeNull();
    expect(blockReason("promote", { ...base, status: "APPROVED", approvedHash: h, configHash: "changed" }, "u2")).toMatch(/changed after approval/);
    expect(blockReason("promote", base, "u2")).toMatch(/approved/);
  });

  it("stops everything but reconfiguring once promoted", () => {
    expect(blockReason("validate", { ...base, status: "PROMOTED" }, "u1")).toMatch(/promoted/);
    expect(blockReason("configure", { ...base, status: "PROMOTED" }, "u1")).toBeNull();
    expect(blockReason("configure", { ...base, status: "ARCHIVED" }, "u1")).toMatch(/archived/);
  });
});

it("starts from a safe empty configuration", () => {
  expect(EMPTY_CONFIG.provenanceEnabled).toBe(true);
  expect(Object.values(EMPTY_CONFIG.operations).every((v) => v === false)).toBe(true);
});
