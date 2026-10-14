import { describe, expect, it } from "vitest";
import { evaluate, parseCondition, references, RuleSyntaxError, validateCondition, type RuleContext } from "./expression";

const run = (src: string, ctx: RuleContext) => evaluate(parseCondition(src), ctx);

const alice: RuleContext = {
  identity: { department: "Finance", contractor: false, email: "alice@acme.com", level: 4, startDate: "2026-01-05", costCentre: "", tags: null },
  manager: { status: "active" },
};

describe("parseCondition", () => {
  it("parses the design's examples", () => {
    for (const src of [
      'identity.department = "Finance" and not identity.contractor',
      'new.title != old.title and manager.status in ["active", "leave"]',
      'identity.email matches "@acme\\.com$"',
      "exists identity.costCentre",
      "changed identity.department",
      'identity.department was "Sales"',
      "identity.level >= 3 or (identity.level < 0 and identity.level ≠ -1)",
    ])
      expect(() => parseCondition(src), src).not.toThrow();
  });

  it("reports the position of a problem", () => {
    const err = (src: string) => {
      try {
        parseCondition(src);
      } catch (e) {
        return e as RuleSyntaxError;
      }
      throw new Error(`parsed: ${src}`);
    };
    expect(err('identity.department = "Finance').message).toMatch(/Unclosed text \(at 23\)/);
    expect(err("identity.department = ").message).toMatch(/ends too soon/);
    expect(err("person.department = 1").message).toMatch(/Unknown reference "person.department"/);
    expect(err("identity = 1").message).toMatch(/Name a field/);
    expect(err("identity.a = 1 identity.b = 2").position).toBe(15);
    expect(err("identity.a = 1 ; drop").message).toMatch(/Unexpected ";"/);
    expect(err("(identity.a = 1").message).toMatch(/Expected "\)"/);
    expect(err("exists 1").message).toMatch(/takes a reference/);
    expect(err('identity.a in "x"').message).toMatch(/takes a list/);
    expect(err("identity.a in [identity.b]").message).toMatch(/plain values/);
    expect(err('identity.a matches "("').message).toMatch(/Not a valid pattern/);
    expect(err('"x" was "y"').message).toMatch(/compares a reference/);
    expect(err("and identity.a").message).toMatch(/Unexpected "and"/);
  });

  it("refuses runaway input: length, depth and backtracking patterns", () => {
    expect(() => parseCondition(`identity.a = "${"x".repeat(4000)}"`)).toThrow(/at most 4000/);
    expect(() => parseCondition(`${"(".repeat(40)}identity.a${")".repeat(40)}`)).toThrow(/nested too deeply/);
    expect(() => parseCondition(`${"not ".repeat(40)}identity.a`)).toThrow(/nested too deeply/);
    expect(() => parseCondition('identity.a matches "(a+)+$"')).toThrow(/nested repeats/);
    expect(() => parseCondition(`identity.a matches "${"a".repeat(201)}"`)).toThrow(/at most 200/);
  });
});

describe("evaluate", () => {
  it("compares text without regard to case, and numbers written as text as numbers", () => {
    expect(run('identity.department = "finance"', alice)).toBe(true);
    expect(run('identity.level = "4"', alice)).toBe(true);
    expect(run("identity.level > 3 and identity.level <= 4", alice)).toBe(true);
    expect(run('identity.startDate < "2026-02-01"', alice)).toBe(true);
    expect(run('manager.status in ["Active", "leave"]', alice)).toBe(true);
    expect(run('identity.email matches "@ACME\\.com$"', alice)).toBe(true);
    expect(run("not identity.contractor and true", alice)).toBe(true);
    expect(run("identity.contractor or false", alice)).toBe(false);
  });

  it("fails closed on what is missing: only exists and != are true about absence", () => {
    expect(run('identity.region = "EMEA"', alice)).toBe(false);
    expect(run("identity.region < 5", alice)).toBe(false);
    expect(run('identity.region in ["EMEA"]', alice)).toBe(false);
    expect(run('identity.region matches "."', alice)).toBe(false);
    expect(run('identity.region != "EMEA"', alice)).toBe(true);
    expect(run("exists identity.region", alice)).toBe(false);
    expect(run("exists identity.costCentre", alice)).toBe(false);
    expect(run("exists identity.tags", alice)).toBe(false);
    expect(run("exists identity.department", alice)).toBe(true);
    expect(run('owner.department = "Finance"', alice)).toBe(false);
    expect(run('identity.level < "abc"', alice)).toBe(false);
  });

  it("changed and was read the old and new values", () => {
    const move: RuleContext = { identity: { department: "Finance" }, old: { department: "Sales", title: "Rep" }, new: { department: "Finance", title: "rep" } };
    expect(run("changed identity.department", move)).toBe(true);
    expect(run("changed new.title", move)).toBe(false);
    expect(run("changed identity.location", move)).toBe(false);
    expect(run('identity.department was "Sales"', move)).toBe(true);
    expect(run('identity.department was "Finance"', move)).toBe(false);
    expect(run('identity.department was "Sales"', { identity: { department: "Finance" } })).toBe(false);
    expect(run("changed manager.status", move)).toBe(false);
    expect(run("changed identity.location", { old: { location: "Pune" }, new: {} })).toBe(true);
  });

  it("never reaches prototype members", () => {
    expect(run("exists identity.constructor", { identity: {} })).toBe(false);
    expect(run("exists identity.toString", { identity: {} })).toBe(false);
    expect(run("exists identity.__proto__", { identity: {} })).toBe(false);
    expect(run("exists identity.department.length", alice)).toBe(false);
  });

  it("follows nested paths", () => {
    expect(run('identity.address.city = "Pune"', { identity: { address: { city: "Pune" } } })).toBe(true);
  });
});

describe("references and validateCondition", () => {
  it("lists what a condition reads", () => {
    expect(references(parseCondition('identity.a = 1 and (manager.b in ["x"] or not exists identity.a)')).sort()).toEqual(["identity.a", "manager.b"]);
  });

  it("an attribute the organization has not defined fails validation", () => {
    const known = { identityFields: ["department", "Region"] };
    expect(validateCondition('identity.region = "EMEA" and manager.department = "x"', known)).toMatchObject({ ok: true });
    const bad = validateCondition('identity.costCentre = "1" and application.name = "SAP"', known);
    expect(bad).toEqual({ ok: false, errors: ['Unknown attribute "identity.costCentre": define it first, or use a standard field'] });
    expect(validateCondition("identity.", known)).toMatchObject({ ok: false });
  });
});
