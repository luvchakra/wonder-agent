import { describe, expect, it } from "vitest";
import { sameDefinition, changedFields, identityView, planAttributeWrites, RULE_PRIORITY, rowFromIdentity, ruleContext, shapeRuleInput, toRuntimeRule } from "./attributeRules";

const defs = [
  { name: "region", displayName: "Region", identityType: null, dataType: "enum", required: false, allowedValues: ["EMEA", "AMER"], validationRegex: null, active: true },
  { name: "costCentre", displayName: "Cost centre", identityType: "HUMAN", dataType: "string", required: false, allowedValues: [], validationRegex: null, active: true },
  { name: "badge", displayName: "Badge", identityType: "SERVICE_ACCOUNT", dataType: "string", required: false, allowedValues: [], validationRegex: null, active: true },
] as never[];

const row = {
  id: "i1",
  identity_type: "HUMAN",
  display_name: "ada",
  department: "Finance",
  title: null,
  attributes: { costCentre: "CC-1" },
  field_provenance: { department: { sourceId: "src-hr", priority: 1, at: "2026-10-01T00:00:00Z" } },
};
const at = "2026-10-14T00:00:00Z";
const apply = (effects: { attribute: string; value: unknown }[], ruleId = "r1") => [
  { ruleId, ruleVersion: 2, effects: effects.map((e) => ({ type: "set_attribute" as const, params: { attribute: e.attribute, value: e.value as string }, viaRequest: false })) },
];

describe("identityView and the rule context", () => {
  it("shows standard fields over custom attributes of the same name", () => {
    expect(identityView({ display_name: "Ada", attributes: { displayName: "shadow", region: "EMEA" } })).toMatchObject({ displayName: "Ada", region: "EMEA" });
    expect(identityView(null)).toBeNull();
  });
  it("gives a change trigger the old and new values", () => {
    const ctx = ruleContext({ department: "Finance", attributes: {} }, { display_name: "Boss", attributes: {} }, { department: "Sales", attributes: {} });
    expect(ctx.old).toMatchObject({ department: "Sales" });
    expect(ctx.new).toMatchObject({ department: "Finance" });
    expect(ctx.manager).toMatchObject({ displayName: "Boss" });
  });
  it("finds what an edit changed, standard and custom", () => {
    const before = rowFromIdentity({ department: "Sales", attributes: { region: "AMER" } });
    const after = rowFromIdentity({ department: "Finance", attributes: { region: "AMER", costCentre: "CC-9" } });
    expect(changedFields(before, after).sort()).toEqual(["costCentre", "department"]);
  });
});

describe("planAttributeWrites", () => {
  it("writes custom attributes and standard fields with rule provenance", () => {
    const plan = planAttributeWrites(
      row,
      apply([
        { attribute: "region", value: "EMEA" },
        { attribute: "displayName", value: "Ada Lovelace" },
      ]),
      defs,
      at,
    );
    expect(plan.columns).toEqual({ display_name: "Ada Lovelace" });
    expect(plan.attributes).toEqual({ costCentre: "CC-1", region: "EMEA" });
    expect(plan.provenance["attributes.region"]).toEqual({ sourceId: "rule:r1", priority: RULE_PRIORITY, at, ruleId: "r1", ruleVersion: 2 });
    expect(plan.provenance.displayName).toMatchObject({ sourceId: "rule:r1" });
    expect(plan.written.map((w) => w.attribute)).toEqual(["region", "displayName"]);
  });

  it("never overrides a value a connected source set", () => {
    const plan = planAttributeWrites(row, apply([{ attribute: "department", value: "Treasury" }]), defs, at);
    expect(plan.columns).toEqual({});
    expect(plan.skipped).toEqual([{ ruleId: "r1", attribute: "department", reason: "set by a connected source, which a rule never overrides" }]);
    expect(plan.provenance.department.sourceId).toBe("src-hr");
  });

  it("may replace its own earlier value", () => {
    const own = { ...row, attributes: { region: "AMER" }, field_provenance: { "attributes.region": { sourceId: "rule:r0", priority: RULE_PRIORITY, at } } };
    expect(planAttributeWrites(own, apply([{ attribute: "region", value: "EMEA" }]), defs, at).attributes).toEqual({ region: "EMEA" });
  });

  it("skips what the identity type does not have, invalid values and an empty display name", () => {
    const plan = planAttributeWrites(
      row,
      apply([
        { attribute: "badge", value: "B1" },
        { attribute: "region", value: "MARS" },
        { attribute: "displayName", value: null },
        { attribute: "status", value: "terminated" },
      ]),
      defs,
      at,
    );
    expect(plan.written).toEqual([]);
    expect(plan.skipped.map((s) => s.attribute)).toEqual(["badge", "region", "displayName", "status"]);
    expect(plan.attributes).toBeNull();
  });

  it("a value already in place is not a write; clearing removes the attribute", () => {
    expect(planAttributeWrites(row, apply([{ attribute: "costCentre", value: "CC-1" }]), defs, at).written).toEqual([]);
    const cleared = planAttributeWrites(row, apply([{ attribute: "costCentre", value: null }]), defs, at);
    expect(cleared.attributes).toEqual({});
  });

  it("a later rule wins on the same attribute", () => {
    const plan = planAttributeWrites(row, [...apply([{ attribute: "region", value: "AMER" }], "r1"), ...apply([{ attribute: "region", value: "EMEA" }], "r2")], defs, at);
    expect(plan.attributes?.region).toBe("EMEA");
    expect(plan.provenance["attributes.region"].ruleId).toBe("r2");
  });
});

describe("shapeRuleInput", () => {
  const base = {
    name: "Region from cost centre",
    triggerType: "identity.created",
    condition: 'identity.costCentre matches "^CC-"',
    effects: [{ type: "set_attribute", params: { attribute: "region", value: "EMEA" } }],
  };

  it("accepts a rule and starts it as written", () => {
    expect(shapeRuleInput(base)).toMatchObject({ name: "Region from cost centre", trigger_type: "identity.created", mode: "report_only", priority: 100, scope: {} });
    expect(shapeRuleInput({ ...base, effects: [{ type: "set_attribute", params: { attribute: "displayName", value: { template: "{identity.firstName} {identity.lastName}" } } }] })).not.toHaveProperty(
      "error",
    );
  });

  it("refuses what an attribute rule cannot be", () => {
    const err = (over: Record<string, unknown>) => (shapeRuleInput({ ...base, ...over }) as { error: string }).error;
    expect(err({ name: " " })).toMatch(/^name/);
    expect(err({ triggerType: "identity.deleted" })).toMatch(/^triggerType/);
    expect(err({ triggerAttribute: "department" })).toMatch(/only for identity.attribute_changed/);
    expect(err({ triggerSource: "Workday" })).toMatch(/not for identity.created/);
    expect(err({ mode: "auto" })).toMatch(/^mode/);
    expect(err({ priority: 1.5 })).toMatch(/^priority/);
    expect(err({ scope: { organizations: ["x"] } })).toMatch(/identityTypes and sources only/);
    expect(err({ effects: [] })).toMatch(/one to twenty/);
    expect(err({ effects: [{ type: "assign_package", params: { package: "p" } }] })).toMatch(/set attributes/);
    expect(err({ effects: [{ type: "set_attribute", params: { attribute: "region", value: { ref: "identity.x", extra: 1 } } }] })).toMatch(/a value/);
  });

  it("an edit keeps what it does not change", () => {
    const current = shapeRuleInput(base) as Exclude<ReturnType<typeof shapeRuleInput>, { error: string }>;
    expect(shapeRuleInput({ mode: "enforce" }, current)).toMatchObject({ name: base.name, condition: base.condition, mode: "enforce" });
  });
});

describe("toRuntimeRule", () => {
  const r = {
    id: "r1",
    name: "x",
    published_version: 3,
    trigger_type: "identity.created",
    condition: "false",
    effects: [],
    mode: "report_only",
    priority: 5,
    scope: {},
    published: { trigger: { type: "identity.created" }, scope: {}, condition: "true", effects: [], mode: "enforce", priority: 5 },
  };
  it("runs the published copy live, and simulates the working copy as the next version", () => {
    expect(toRuntimeRule(r, "published")).toMatchObject({ version: 3, condition: "true", mode: "enforce", status: "published", fourEyesApproved: true });
    expect(toRuntimeRule(r, "working")).toMatchObject({ version: 4, condition: "false", mode: "report_only", fourEyesApproved: false });
    expect(toRuntimeRule({ ...r, published: null }, "published")).toBeNull();
  });
});

describe("sameDefinition", () => {
  it("ignores key order, as stored JSON reorders keys", () => {
    expect(
      sameDefinition(
        { mode: "enforce", trigger: { type: "identity.created" }, effects: [{ type: "set_attribute", params: { value: "x", attribute: "a" } }] },
        { effects: [{ params: { attribute: "a", value: "x" }, type: "set_attribute" }], trigger: { type: "identity.created" }, mode: "enforce" },
      ),
    ).toBe(true);
    expect(sameDefinition({ mode: "enforce" }, { mode: "report_only" })).toBe(false);
    expect(sameDefinition({ a: [1, 2] }, { a: [2, 1] })).toBe(false);
    expect(sameDefinition(null, { mode: "enforce" })).toBe(false);
  });
});
