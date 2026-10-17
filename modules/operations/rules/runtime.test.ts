import { describe, expect, it } from "vitest";
import { evaluateRules, ruleReferences, simulateRules, validateRule, type Rule } from "./runtime";

const rule = (over: Partial<Rule>): Rule => ({
  id: "r1",
  version: 1,
  name: "rule",
  trigger: { type: "identity.created" },
  condition: "true",
  effects: [],
  mode: "enforce",
  priority: 10,
  status: "published",
  ...over,
});

const subject = { id: "u1", identityType: "HUMAN", organization: "Acme", source: "workday" };
const created = { type: "identity.created" };
const ctx = { identity: { firstName: "Ada", lastName: "Lovelace", department: "Finance", region: null } };

describe("evaluateRules", () => {
  it("runs matching published rules in priority order; a later rule sees an earlier enforced effect", () => {
    const rules = [
      rule({ id: "b", priority: 20, condition: 'identity.region = "EMEA"', effects: [{ type: "assign_package", params: { package: "emea-basics" } }] }),
      rule({ id: "a", priority: 10, condition: 'identity.department = "Finance"', effects: [{ type: "set_attribute", params: { attribute: "region", value: "EMEA" } }] }),
    ];
    const { log, context } = evaluateRules(rules, created, subject, ctx);
    expect(log.map((l) => [l.ruleId, l.outcome])).toEqual([
      ["a", "applied"],
      ["b", "applied"],
    ]);
    expect(log[0].effects[0]).toMatchObject({ type: "set_attribute", params: { attribute: "region", value: "EMEA" }, before: null });
    expect(context.identity?.region).toBe("EMEA");
  });

  it("a report-only rule records what it would do and changes nothing for later rules", () => {
    const rules = [
      rule({ id: "a", mode: "report_only", effects: [{ type: "set_attribute", params: { attribute: "region", value: "EMEA" } }] }),
      rule({ id: "b", priority: 20, condition: 'identity.region = "EMEA"', effects: [{ type: "notify", params: { template: "t", recipients: "x" } }] }),
    ];
    const { log, context } = evaluateRules(rules, created, subject, ctx);
    expect(log.map((l) => l.outcome)).toEqual(["reported", "not_matched"]);
    expect(log[0].effects).toHaveLength(1);
    expect(context.identity?.region).toBeNull();
  });

  it("only published rules run live; drafts and retired rules do not", () => {
    const rules = [rule({ id: "d", status: "draft" }), rule({ id: "s", status: "simulated" }), rule({ id: "x", status: "retired" })];
    expect(evaluateRules(rules, created, subject, ctx).log).toEqual([]);
    expect(evaluateRules(rules, created, subject, ctx, { includeUnpublished: true }).log.map((l) => l.ruleId)).toEqual(["d", "s"]);
  });

  it("matches the trigger, its named attribute and source", () => {
    const rules = [
      rule({ id: "dept", trigger: { type: "identity.attribute_changed", attribute: "department" } }),
      rule({ id: "any", trigger: { type: "identity.attribute_changed" } }),
      rule({ id: "hr", trigger: { type: "identity.attribute_changed", source: "Workday" } }),
    ];
    const ids = (e: Parameters<typeof evaluateRules>[1]) => evaluateRules(rules, e, subject, ctx).log.map((l) => l.ruleId);
    expect(ids({ type: "identity.attribute_changed", changedAttributes: ["title"] })).toEqual(["any"]);
    expect(ids({ type: "identity.attribute_changed", changedAttributes: ["Department"], source: "workday" })).toEqual(["any", "dept", "hr"]);
    expect(ids(created)).toEqual([]);
  });

  it("respects scope", () => {
    const rules = [rule({ scope: { identityTypes: ["SERVICE_ACCOUNT"] } }), rule({ id: "r2", scope: { organizations: ["acme"], sources: [] } })];
    expect(evaluateRules(rules, created, subject, ctx).log.map((l) => [l.ruleId, l.outcome])).toEqual([
      ["r1", "out_of_scope"],
      ["r2", "applied"],
    ]);
    expect(evaluateRules([rule({ scope: { applications: ["SAP"] } })], created, subject, ctx).log[0].outcome).toBe("out_of_scope");
  });

  it("a rule that cannot be evaluated is an error entry with no effects, and the rest still run", () => {
    const rules = [rule({ id: "bad", condition: "identity.department = " }), rule({ id: "ok", priority: 20, effects: [{ type: "require_recertification", params: {} }] })];
    const { log } = evaluateRules(rules, created, subject, ctx);
    expect(log[0]).toMatchObject({ ruleId: "bad", outcome: "error", effects: [] });
    expect(log[0].error).toMatch(/ends too soon/);
    expect(log[1]).toMatchObject({ ruleId: "ok", outcome: "applied" });
  });

  it("resolves effect values from the context", () => {
    const rules = [rule({ effects: [{ type: "set_attribute", params: { attribute: "displayName", value: { ref: "identity.lastName" } } }] })];
    expect(evaluateRules(rules, created, subject, ctx).log[0].effects[0].params.value).toBe("Lovelace");
  });

  it("builds a value from a template; a missing part is left out, an empty result is null", () => {
    const template = (t: string) =>
      evaluateRules([rule({ effects: [{ type: "set_attribute", params: { attribute: "displayName", value: { template: t } } }] })], created, subject, ctx).log[0].effects[0].params.value;
    expect(template("{identity.firstName} {identity.lastName}")).toBe("Ada Lovelace");
    expect(template("{identity.firstName} {identity.middleName} {identity.lastName}")).toBe("Ada Lovelace");
    expect(template("{identity.nickname}")).toBeNull();
    expect(template("{identity.lastName}-{identity.department}")).toBe("Lovelace-Finance");
  });

  it("a granting effect goes through a request unless the rule was approved under four-eyes", () => {
    const effects: Rule["effects"] = [
      { type: "assign_package", params: { package: "p" } },
      { type: "remove_package", params: { package: "q" } },
    ];
    expect(evaluateRules([rule({ effects })], created, subject, ctx).log[0].effects.map((e) => e.viaRequest)).toEqual([true, false]);
    expect(evaluateRules([rule({ effects, fourEyesApproved: true })], created, subject, ctx).log[0].effects.map((e) => e.viaRequest)).toEqual([false, false]);
  });

  it("is deterministic and leaves the caller's context untouched", () => {
    const rules = [rule({ effects: [{ type: "set_attribute", params: { attribute: "region", value: "APAC" } }] })];
    const a = evaluateRules(rules, created, subject, ctx);
    const b = evaluateRules(rules, created, subject, ctx);
    expect(a).toEqual(b);
    expect(ctx.identity.region).toBeNull();
  });
});

describe("validateRule", () => {
  const known = { identityFields: ["department", "region", "displayName", "lastName"], triggers: ["identity.created"] };

  it("accepts a well-formed rule", () => {
    expect(
      validateRule(rule({ condition: 'identity.department = "Finance"', effects: [{ type: "set_attribute", params: { attribute: "region", value: { ref: "identity.lastName" } } }] }), known),
    ).toEqual([]);
  });

  it("checks the references inside a template", () => {
    const problems = validateRule(
      {
        trigger: { type: "identity.created" },
        condition: "true",
        priority: 1,
        effects: [{ type: "set_attribute", params: { attribute: "region", value: { template: "{identity.lastName} {identity.shoeSize}" } } }],
      },
      known,
    );
    expect(problems.map((p) => p.field)).toEqual(["effects.0.value"]);
    expect(
      validateRule(
        { trigger: { type: "identity.created" }, condition: "true", priority: 1, effects: [{ type: "set_attribute", params: { attribute: "region", value: { template: "x".repeat(501) } } }] },
        known,
      )[0].message,
    ).toMatch(/at most 500/);
  });

  it("names every problem", () => {
    const problems = validateRule(
      {
        trigger: { type: "identity.teleported" },
        condition: 'identity.costCentre = "1"',
        priority: 1.5,
        effects: [
          { type: "set_attribute", params: { attribute: "nickname", value: { ref: "identity.shoeSize" } } },
          { type: "assign_package", params: {} },
          { type: "format_disk" as never, params: {} },
        ],
      },
      known,
    );
    expect(problems.map((p) => p.field)).toEqual(["trigger", "condition", "priority", "effects.0.attribute", "effects.0.value", "effects.1.package", "effects.1.approval", "effects.2"]);
    expect(validateRule({ trigger: { type: "identity.created" }, condition: "true", priority: 1, effects: [] }, known)).toEqual([{ field: "effects", message: "Add at least one effect" }]);
  });
});

describe("simulateRules", () => {
  const people = [
    { subject: { id: "u1", identityType: "HUMAN" }, context: { identity: { department: "Finance", region: null, lifecycleState: "active" } } },
    { subject: { id: "u2", identityType: "HUMAN" }, context: { identity: { department: "Finance", region: "EMEA", lifecycleState: "active" } } },
    { subject: { id: "u3", identityType: "HUMAN" }, context: { identity: { department: "Sales", region: null, lifecycleState: "active" } } },
    { subject: { id: "u4", identityType: "HUMAN" }, context: { identity: { department: "Sales", region: null, lifecycleState: "leaver" } } },
  ];

  it("lists who gains, loses or changes what, as if enforced, and skips no-op changes", () => {
    const rules = [
      rule({ id: "region", mode: "report_only", status: "draft", condition: 'identity.department = "Finance"', effects: [{ type: "set_attribute", params: { attribute: "region", value: "EMEA" } }] }),
      rule({ id: "pkg", priority: 20, condition: 'identity.region = "EMEA"', effects: [{ type: "assign_package", params: { package: "emea" } }] }),
      rule({
        id: "leave",
        priority: 30,
        condition: 'identity.department = "Sales"',
        effects: [
          { type: "lifecycle_transition", params: { to: "leaver" } },
          { type: "remove_package", params: { package: "crm" } },
        ],
      }),
      rule({ id: "old", status: "retired", effects: [{ type: "notify", params: { template: "t", recipients: "r" } }] }),
    ];
    const r = simulateRules(rules, created, people);
    expect(r.evaluated).toBe(4);
    expect(r.affected).toBe(4);
    expect(r.changes.map((c) => [c.subjectId, c.type, c.before])).toEqual([
      ["u1", "set_attribute", null],
      ["u3", "lifecycle_transition", "active"],
    ]);
    expect(r.gains.map((c) => c.subjectId)).toEqual(["u1", "u2"]);
    expect(r.losses.map((c) => c.subjectId)).toEqual(["u3", "u4"]);
    expect(r.other).toEqual([]);
    expect(r.held).toBe(false);
  });

  it("holds a run that would touch more than the allowed share", () => {
    const rules = [rule({ effects: [{ type: "remove_package", params: { package: "all" } }] })];
    expect(simulateRules(rules, created, people, { maxAffectedShare: 0.5 }).held).toBe(true);
    expect(simulateRules(rules, created, people, { maxAffectedShare: 1 }).held).toBe(false);
    expect(simulateRules(rules, created, [], { maxAffectedShare: 0 }).held).toBe(false);
  });

  it("reports errors per subject", () => {
    const r = simulateRules([rule({ condition: "identity.a ==" })], created, people.slice(0, 2));
    expect(r.errors).toHaveLength(2);
    expect(r.affected).toBe(0);
  });
});

describe("ruleReferences", () => {
  it("lists condition and effect references", () => {
    expect(ruleReferences({ condition: 'identity.department = "x"', effects: [{ type: "set_manager", params: { value: { ref: "manager.id" } } }] }).sort()).toEqual([
      "identity.department",
      "manager.id",
    ]);
    expect(ruleReferences({ condition: "((", effects: [] })).toEqual([]);
  });
});
