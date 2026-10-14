import { describe, expect, it } from "vitest";
import { belongsToApplication, countsOf, planEntitlements, planFingerprint, planGrants, type ExistingEntitlement, type ExistingGrant } from "./connectorAccessRules";

const INT = "int-1";
const ent = (over: Partial<ExistingEntitlement>): ExistingEntitlement => ({
  id: "e?",
  name: "?",
  privilegeLevel: "standard",
  dataClassification: null,
  sourceIntegrationId: INT,
  externalRef: null,
  missingFromSourceAt: null,
  ...over,
});
const grant = (over: Partial<ExistingGrant>): ExistingGrant => ({ id: "g?", accountId: "a1", entitlementId: "e1", grantType: "direct", sourceIntegrationId: INT, missingFromSourceAt: null, ...over });
const staged = (externalId: string, values: Record<string, unknown>) => ({ externalId, values });

describe("planEntitlements", () => {
  it("adds new entitlements, updates changed ones and leaves the rest", () => {
    const plan = planEntitlements({
      integrationId: INT,
      mode: "full",
      staged: [staged("cn=fin", { name: "Finance", privilegeLevel: "admin" }), staged("cn=hr", { name: "HR" }), staged("cn=ops", { name: "Ops" })],
      existing: [ent({ id: "e1", name: "Finance", externalRef: "cn=fin" }), ent({ id: "e2", name: "HR", externalRef: "cn=hr" })],
    });
    expect(plan.creates).toEqual([{ ref: "cn=ops", name: "Ops", privilegeLevel: "standard", dataClassification: null, entitlementType: null }]);
    expect(plan.updates).toEqual([{ id: "e1", ref: "cn=fin", name: "Finance", changes: [{ field: "privilegeLevel", from: "standard", to: "admin" }], set: { privilege_level: "admin" } }]);
    expect(plan.unchanged).toBe(1);
    expect(plan.byRef.get("cn=ops")).toBe("new:cn=ops");
    expect(plan.byRef.get("cn=fin")).toBe("e1");
  });

  it("ACCESS-P0-33: takes the connector's type, but never over a type a person set", () => {
    const plan = planEntitlements({
      integrationId: INT,
      mode: "full",
      staged: [staged("cn=new", { name: "New", type: "group" }), staged("cn=a", { name: "A", type: "role" }), staged("cn=b", { name: "B", type: "role" })],
      existing: [ent({ id: "ea", name: "A", externalRef: "cn=a", entitlementType: "group" }), ent({ id: "eb", name: "B", externalRef: "cn=b", entitlementType: "license", typeSetByPerson: true })],
    });
    expect(plan.creates[0]).toMatchObject({ ref: "cn=new", entitlementType: "group" });
    expect(plan.updates).toEqual([{ id: "ea", ref: "cn=a", name: "A", changes: [{ field: "type", from: "group", to: "role" }], set: { entitlement_type: "role" } }]);
    expect(plan.unchanged).toBe(1);
  });

  it("adopts a hand-made entitlement with the same unique name instead of duplicating it", () => {
    const plan = planEntitlements({ integrationId: INT, mode: "full", staged: [staged("r-9", { name: "Payroll" })], existing: [ent({ id: "e9", name: "payroll", sourceIntegrationId: null })] });
    expect(plan.creates).toEqual([]);
    expect(plan.updates[0]).toMatchObject({ id: "e9", set: { source_integration_id: INT, external_ref: "r-9", name: "Payroll" } });
  });

  it("refuses to guess between two same-named entitlements", () => {
    const plan = planEntitlements({
      integrationId: INT,
      mode: "full",
      staged: [staged("r-1", { name: "Admin" })],
      existing: [ent({ id: "a", name: "Admin", sourceIntegrationId: null }), ent({ id: "b", name: "Admin", sourceIntegrationId: null })],
    });
    expect(plan.creates).toEqual([]);
    expect(plan.invalid[0].reason).toMatch(/2 entitlements/);
  });

  it("in a full run marks the connector's unlisted entitlements removed, never other sources'", () => {
    const plan = planEntitlements({
      integrationId: INT,
      mode: "full",
      staged: [],
      existing: [ent({ id: "e1", name: "Gone", externalRef: "x" }), ent({ id: "e2", name: "Manual", sourceIntegrationId: null }), ent({ id: "e3", name: "Other", sourceIntegrationId: "int-2", externalRef: "y" })],
    });
    expect(plan.removed.map((r) => r.id)).toEqual(["e1"]);
  });

  it("an incremental run never removes; a relisted entitlement is restored", () => {
    const existing = [ent({ id: "e1", name: "Back", externalRef: "x", missingFromSourceAt: "2026-10-01T00:00:00Z" }), ent({ id: "e2", name: "Absent", externalRef: "z" })];
    const plan = planEntitlements({ integrationId: INT, mode: "incremental", staged: [staged("x", { name: "Back" })], existing });
    expect(plan.removed).toEqual([]);
    expect(plan.restored.map((r) => r.id)).toEqual(["e1"]);
  });

  it("skips duplicates and nameless records", () => {
    const plan = planEntitlements({ integrationId: INT, mode: "full", staged: [staged("a", { name: "A" }), staged("a", { name: "A2" }), staged("b", {})], existing: [] });
    expect(plan.creates.map((c) => c.ref)).toEqual(["a"]);
    expect(plan.invalid.map((i) => i.reason)).toEqual(["listed twice by the source", "no name"]);
  });
});

describe("planGrants", () => {
  const accountByRef = new Map([["acc-1", "a1"], ["acc-2", "a2"]]);
  const entitlementByRef = new Map([["cn=fin", "e1"], ["cn=new", "new:cn=new"]]);

  it("adds grants, keeps existing ones (from any source) and reports what it cannot resolve", () => {
    const plan = planGrants({
      integrationId: INT,
      mode: "full",
      staged: [
        staged("g1", { accountExternalId: "acc-1", entitlementExternalId: "cn=fin" }),
        staged("g2", { accountExternalId: "acc-2", entitlementExternalId: "cn=new", grantType: "GROUP" }),
        staged("g3", { accountExternalId: "nobody", entitlementExternalId: "cn=fin" }),
        staged("g4", { accountExternalId: "acc-1", entitlementExternalId: "cn=unknown" }),
      ],
      accountByRef,
      entitlementByRef,
      existing: [grant({ id: "g-req", sourceIntegrationId: null })],
    });
    expect(plan.unchanged).toBe(1);
    expect(plan.creates).toEqual([{ ref: "g2", accountId: "a2", entitlementId: "new:cn=new", grantType: "group" }]);
    expect(plan.unresolved.map((u) => u.ref)).toEqual(["g3", "g4"]);
    expect(plan.removed).toEqual([]);
  });

  it("verifies a requested grant the source now lists, and never marks an unlisted one removed (ACCESS-P0-28)", () => {
    const plan = planGrants({
      integrationId: INT,
      mode: "full",
      staged: [staged("x", { accountExternalId: "acc-1", entitlementExternalId: "cn=fin" })],
      accountByRef,
      entitlementByRef,
      existing: [
        grant({ id: "g-pending", sourceIntegrationId: null, fulfilmentStatus: "pending_fulfilment" }),
        grant({ id: "g-other", accountId: "a2", sourceIntegrationId: null, fulfilmentStatus: "fulfilled_unverified" }),
      ],
    });
    expect(plan.verified.map((v) => v.id)).toEqual(["g-pending"]);
    expect(plan.unchanged).toBe(0);
    expect(plan.creates).toEqual([]);
    expect(plan.removed).toEqual([]);
  });

  it("revokes a grant whose removal was approved once a full run no longer finds it; an incremental run never does (ACCESS-P0-30)", () => {
    const existing = [grant({ id: "g-rm", removalStatus: "removed_unverified" }), grant({ id: "g-keep", accountId: "a2", removalStatus: "pending_removal" })];
    const listed = [staged("x", { accountExternalId: "acc-2", entitlementExternalId: "cn=fin" })];
    const full = planGrants({ integrationId: INT, mode: "full", staged: listed, accountByRef, entitlementByRef, existing });
    expect(full.revoked.map((r) => r.id)).toEqual(["g-rm"]);
    expect(full.removed).toEqual([]);
    expect(planGrants({ integrationId: INT, mode: "incremental", staged: listed, accountByRef, entitlementByRef, existing }).revoked).toEqual([]);
  });

  it("in a full run marks this connection's unlisted grants removed; relisting restores them", () => {
    const gone = planGrants({ integrationId: INT, mode: "full", staged: [], accountByRef, entitlementByRef, existing: [grant({ id: "g1" }), grant({ id: "g2", accountId: "a2", sourceIntegrationId: null })] });
    expect(gone.removed.map((r) => r.id)).toEqual(["g1"]);
    const back = planGrants({
      integrationId: INT,
      mode: "full",
      staged: [staged("x", { accountExternalId: "acc-1", entitlementExternalId: "cn=fin" })],
      accountByRef,
      entitlementByRef,
      existing: [grant({ id: "g1", missingFromSourceAt: "2026-10-01T00:00:00Z" })],
    });
    expect(back.restored.map((r) => r.id)).toEqual(["g1"]);
    expect(back.creates).toEqual([]);
  });

  it("an incremental run never removes, and an unknown grant type falls back to direct", () => {
    const plan = planGrants({
      integrationId: INT,
      mode: "incremental",
      staged: [staged("x", { accountExternalId: "acc-2", entitlementExternalId: "cn=fin", grantType: "magic" })],
      accountByRef,
      entitlementByRef,
      existing: [grant({ id: "g1" })],
    });
    expect(plan.removed).toEqual([]);
    expect(plan.creates[0].grantType).toBe("direct");
  });
});

describe("idempotence and the preview fingerprint", () => {
  it("re-running against what an apply wrote plans nothing", () => {
    const existing = [ent({ id: "e1", name: "Finance", externalRef: "cn=fin" })];
    const ents = planEntitlements({ integrationId: INT, mode: "full", staged: [staged("cn=fin", { name: "Finance" })], existing });
    const grants = planGrants({
      integrationId: INT,
      mode: "full",
      staged: [staged("g", { accountExternalId: "acc-1", entitlementExternalId: "cn=fin" })],
      accountByRef: new Map([["acc-1", "a1"]]),
      entitlementByRef: ents.byRef,
      existing: [grant({ id: "g1" })],
    });
    expect(countsOf(ents, grants)).toEqual({
      entitlements: { added: 0, changed: 0, removed: 0, restored: 0, unchanged: 1, invalid: 0 },
      grants: { added: 0, removed: 0, restored: 0, verified: 0, revoked: 0, unchanged: 1, unresolved: 0 },
    });
  });

  it("the fingerprint ignores order and changes when the plan does", () => {
    const a = planEntitlements({ integrationId: INT, mode: "full", staged: [staged("1", { name: "A" }), staged("2", { name: "B" })], existing: [] });
    const b = planEntitlements({ integrationId: INT, mode: "full", staged: [staged("2", { name: "B" }), staged("1", { name: "A" })], existing: [] });
    const c = planEntitlements({ integrationId: INT, mode: "full", staged: [staged("1", { name: "A" })], existing: [] });
    const none = planGrants({ integrationId: INT, mode: "full", staged: [], accountByRef: new Map(), entitlementByRef: new Map(), existing: [] });
    expect(planFingerprint(a, none)).toBe(planFingerprint(b, none));
    expect(planFingerprint(a, none)).not.toBe(planFingerprint(c, none));
  });
});

describe("belongsToApplication", () => {
  it("takes records naming no application, or this one by id or name", () => {
    const app = { id: "11111111-1111-4111-8111-111111111111", name: "SAP" };
    expect(belongsToApplication({}, app)).toBe(true);
    expect(belongsToApplication({ application: "sap" }, app)).toBe(true);
    expect(belongsToApplication({ application: app.id.toUpperCase() }, app)).toBe(true);
    expect(belongsToApplication({ application: "Snowflake" }, app)).toBe(false);
  });
});
