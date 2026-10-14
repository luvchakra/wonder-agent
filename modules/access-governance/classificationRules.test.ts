import { describe, expect, it } from "vitest";
import { evaluateRules } from "@/modules/operations/rules/runtime";
import { classificationContext, planEntitlementWrites, shapeClassificationRule, toRuntimeRule } from "./classificationRules";

const at = "2026-10-14T00:00:00Z";
const row = {
  id: "e1",
  name: "billing-admin",
  entitlement_type: "group",
  privilege_level: "standard",
  data_classification: null,
  requestable: true,
  sox_relevant: false,
  owner_identity_id: null,
  external_ref: "cn=billing-admin",
  field_provenance: {},
};
const app = { name: "AWS", display_name: "Amazon Web Services", risk_level: "high", data_classification: "confidential", app_type: "cloud", vendor: "Amazon" };
const effects = (list: [string, unknown][], ruleId = "r1") => [
  { ruleId, ruleVersion: 3, effects: list.map(([attribute, value]) => ({ type: "set_attribute" as const, params: { attribute, value: value as string }, viaRequest: false })) },
];

describe("classification rules (ACCESS-P0-33 part 2)", () => {
  it("a rule sees the entitlement and its application, and matches on them", () => {
    const rule = toRuntimeRule(
      {
        id: "r1",
        name: "admins",
        published_version: 1,
        trigger_type: "entitlement.imported",
        condition: "true",
        effects: [],
        mode: "report_only",
        priority: 1,
        published: {
          trigger: { type: "entitlement.imported" },
          scope: {},
          condition: 'entitlement.name matches "-admin$" and application.name = "aws"',
          effects: [{ type: "set_attribute", params: { attribute: "privilegeLevel", value: "admin" } }],
          mode: "enforce",
          priority: 1,
        },
      },
      "published",
    )!;
    const { log } = evaluateRules([rule], { type: "entitlement.imported" }, { id: "e1", application: "app-1" }, classificationContext(row, app, null));
    expect(log[0]).toMatchObject({ outcome: "applied", ruleVersion: 1 });
    const other = evaluateRules([rule], { type: "entitlement.imported" }, { id: "e2" }, classificationContext({ ...row, name: "billing-read" }, app, null));
    expect(other.log[0].outcome).toBe("not_matched");
  });

  it("scope by application", () => {
    const rule = {
      ...toRuntimeRule(
        { id: "r", name: "x", published_version: 0, trigger_type: "entitlement.imported", condition: "true", effects: [], mode: "enforce", priority: 1, scope: { applications: ["app-1"] } },
        "working",
      )!,
    };
    expect(evaluateRules([rule], { type: "entitlement.imported" }, { id: "e", application: "app-2" }, classificationContext(row, app, null), { includeUnpublished: true }).log[0].outcome).toBe(
      "out_of_scope",
    );
  });

  it("writes classified fields with rule provenance; a person's decision stays; invalid values are skipped", () => {
    const plan = planEntitlementWrites(
      row,
      effects([
        ["privilegeLevel", "admin"],
        ["requestable", false],
        ["soxRelevant", true],
        ["dataClassification", "restricted"],
      ]),
      at,
    );
    expect(plan.set).toEqual({ privilege_level: "admin", requestable: false, sox_relevant: true, data_classification: "restricted" });
    expect(plan.provenance.privilege_level).toEqual({ by: "rule", ruleId: "r1", ruleVersion: 3, at });

    const personal = { ...row, field_provenance: { requestable: { by: "person", userId: "u1", at } } };
    const kept = planEntitlementWrites(
      personal,
      effects([
        ["requestable", false],
        ["privilegeLevel", "root"],
      ]),
      at,
    );
    expect(kept.set).toEqual({});
    expect(kept.skipped.map((s) => s.field)).toEqual(["requestable", "privilegeLevel"]);
    expect(kept.skipped[0].reason).toMatch(/set by a person/);
  });

  it("a value already in place is not a write; a later rule wins", () => {
    expect(planEntitlementWrites(row, effects([["entitlementType", "group"]]), at).written).toEqual([]);
    const plan = planEntitlementWrites(row, [...effects([["privilegeLevel", "elevated"]], "r1"), ...effects([["privilegeLevel", "admin"]], "r2")], at);
    expect(plan.set.privilege_level).toBe("admin");
    expect(plan.written).toEqual([{ ruleId: "r2", field: "privilegeLevel", before: "standard", after: "admin" }]);
  });

  it("shapes input and refuses what a classification rule cannot be", () => {
    const base = {
      name: "Admins",
      triggerType: "entitlement.imported",
      condition: 'entitlement.name matches "-admin$"',
      effects: [{ type: "set_attribute", params: { attribute: "privilegeLevel", value: "admin" } }],
    };
    expect(shapeClassificationRule(base)).toMatchObject({ mode: "report_only", scope: {}, trigger_type: "entitlement.imported" });
    const err = (over: Record<string, unknown>) => (shapeClassificationRule({ ...base, ...over }) as { error: string }).error;
    expect(err({ name: "" })).toMatch(/^name/);
    expect(err({ triggerType: "identity.created" })).toMatch(/^triggerType/);
    expect(err({ applicationIds: ["nope"] })).toMatch(/^applicationIds/);
    expect(err({ effects: [{ type: "set_attribute", params: { attribute: "ownerIdentityId", value: "x" } }] })).toMatch(/one of privilegeLevel/);
    expect(err({ effects: [{ type: "set_attribute", params: { attribute: "privilegeLevel", value: "root" } }] })).toMatch(/standard, elevated or admin/);
    expect(err({ effects: [{ type: "assign_package", params: {} }] })).toMatch(/set fields/);
    expect(err({ mode: "auto" })).toMatch(/^mode/);
  });
});
