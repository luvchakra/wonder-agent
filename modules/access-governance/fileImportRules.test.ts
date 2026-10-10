import { describe, expect, it } from "vitest";
import type { ImportRecord } from "@/lib/shared/types/integrations";
import { planAccounts, planApplications, planEntitlements, planGrants, type AccessLookups } from "./fileImportRules";

const APP = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const APP2 = "aaaaaaaa-aaaa-4aaa-8aaa-bbbbbbbbbbbb";
const ENT = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const ACC = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const AGENT_ACC = "cccccccc-cccc-4ccc-8ccc-dddddddddddd";
const PERSON = "11111111-1111-4111-8111-111111111111";

const lookups: AccessLookups = {
  applications: [
    { id: APP, name: "Snowflake", category: "Data", description: null },
    { id: APP2, name: "SAP", category: null, description: "ERP" },
  ],
  entitlements: [{ id: ENT, applicationId: APP, name: "CustomerDB Read", privilegeLevel: "standard", dataClassification: null }],
  accounts: [
    { id: ACC, applicationId: APP, externalAccountRef: "u-ada", accountName: "ada", status: "active", accountType: "standard", lastUsedAt: null, identityId: null, agentId: null },
    { id: AGENT_ACC, applicationId: APP, externalAccountRef: "svc-financebot", accountName: "financebot", status: "active", accountType: "service", lastUsedAt: null, identityId: null, agentId: "agent-1" },
  ],
  grants: [],
  owners: [{ id: PERSON, email: "ada@x.test", username: "ada", sourceNativeId: "E1" }],
};

let row = 1;
const rec = (externalId: string, values: Record<string, unknown>): ImportRecord => ({ row: ++row, externalId, values: { externalId, ...values } });

describe("planApplications", () => {
  it("adds a new application, updates one by name, and leaves an unchanged one alone", () => {
    const plan = planApplications([rec("x1", { name: "Workday", category: "HR" }), rec("x2", { name: "snowflake", description: "Warehouse" }), rec("x3", { name: "SAP" })], lookups);
    expect(plan.map((p) => p.decision)).toEqual(["new", "update", "unchanged"]);
    expect(plan[0]!.insert).toEqual({ name: "Workday", category: "HR", description: null });
    expect(plan[1]).toMatchObject({ targetId: APP, changes: [{ field: "description", from: null, to: "Warehouse" }], update: { description: "Warehouse" } });
  });

  it("renames only when the row names the application by its id, and never onto another's name", () => {
    expect(planApplications([rec(APP, { name: "Snowflake EU" })], lookups)[0]).toMatchObject({ decision: "update", update: { name: "Snowflake EU" } });
    expect(planApplications([rec(APP, { name: "SAP" })], lookups)[0]).toMatchObject({ decision: "invalid", note: 'another application is named "SAP"' });
  });

  it("holds a second row for the same application", () => {
    const plan = planApplications([rec("a", { name: "Workday" }), rec("b", { name: "workday" })], lookups);
    expect(plan[1]).toMatchObject({ decision: "review" });
  });
});

describe("planEntitlements", () => {
  it("needs a known application, matches by application and name, and validates the privilege", () => {
    const plan = planEntitlements(
      [
        rec("e1", { name: "CustomerDB Read", application: "Snowflake", privilegeLevel: "admin" }),
        rec("e2", { name: "Finance Read", application: "Snowflake" }),
        rec("e3", { name: "X", application: "Nope" }),
        rec("e4", { name: "Y", application: "SAP", privilegeLevel: "root" }),
      ],
      lookups,
    );
    expect(plan.map((p) => p.decision)).toEqual(["update", "new", "invalid", "invalid"]);
    expect(plan[0]).toMatchObject({ targetId: ENT, update: { privilege_level: "admin" } });
    expect(plan[1]!.insert).toEqual({ application_id: APP, name: "Finance Read", privilege_level: "standard", data_classification: null });
    expect(plan[2]!.note).toContain('no application named "Nope"');
  });
});

describe("planAccounts", () => {
  it("adds an account linked to its owner, and updates one without ever unlinking it", () => {
    const plan = planAccounts(
      [rec("u-new", { application: "Snowflake", username: "newbie", owner: "ada@x.test", privileged: true }), rec("u-ada", { application: "Snowflake", status: "disabled", owner: "E1" })],
      lookups,
      { integrationId: "conn-1" },
    );
    expect(plan[0]).toMatchObject({ decision: "new", insert: { application_id: APP, external_account_ref: "u-new", account_type: "privileged", identity_id: PERSON, correlation: "manual", source_integration_id: "conn-1" } });
    expect(plan[1]).toMatchObject({ decision: "update", targetId: ACC, update: { status: "disabled", identity_id: PERSON, correlation: "manual" } });
  });

  it("reports an owner it cannot find and refuses unknown values", () => {
    const [a, b] = planAccounts([rec("u-x", { application: "Snowflake", owner: "ghost" }), rec("u-y", { application: "Snowflake", status: "deleted" })], lookups, { integrationId: "c" });
    expect(a).toMatchObject({ decision: "new", note: 'no identity "ghost"; left unlinked', insert: { identity_id: null, correlation: "orphan" } });
    expect(b).toMatchObject({ decision: "invalid" });
  });
});

describe("planGrants", () => {
  it("records reported access for any account, an agent's or a person's, with the file's connection as its source", () => {
    const plan = planGrants(
      [
        rec("svc-financebot:CustomerDB Read", { accountExternalId: "svc-financebot", entitlementExternalId: "CustomerDB Read" }),
        rec("u-ada:CustomerDB Read", { accountExternalId: "u-ada", entitlementExternalId: ENT }),
        rec("nope:x", { accountExternalId: "nope", entitlementExternalId: "x" }),
      ],
      lookups,
      { integrationId: "int-csv" },
    );
    expect(plan.map((p) => p.decision)).toEqual(["new", "new", "invalid"]);
    expect(plan[0]!.insert).toEqual({ account_id: AGENT_ACC, entitlement_id: ENT, grant_type: "direct", source_integration_id: "int-csv" });
    expect(plan[1]!.insert).toEqual({ account_id: ACC, entitlement_id: ENT, grant_type: "direct", source_integration_id: "int-csv" });
    const again = planGrants([rec("svc:e", { accountExternalId: AGENT_ACC, entitlementExternalId: ENT })], { ...lookups, grants: [{ accountId: AGENT_ACC, entitlementId: ENT, grantType: "direct" }] });
    expect(again[0]).toMatchObject({ decision: "unchanged" });
  });

  it("refuses an entitlement of another application than the account's", () => {
    const sapAcc = { ...lookups.accounts![0]!, id: "cccccccc-cccc-4ccc-8ccc-eeeeeeeeeeee", applicationId: APP2, externalAccountRef: "sap-ada" };
    const plan = planGrants([rec("sap-ada:e", { accountExternalId: "sap-ada", entitlementExternalId: ENT })], { ...lookups, accounts: [...lookups.accounts!, sapAcc] });
    expect(plan[0]).toMatchObject({ decision: "invalid" });
    expect(plan[0]!.note).toContain("in the account's application");
  });
});
