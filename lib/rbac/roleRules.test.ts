// @vitest-environment node
import { describe, expect, it } from "vitest";
import { escalationIn, moduleSummary, permissionDiff, validateRoleInput } from "./roleRules";

const CATALOG = ["agent.read", "compliance.read", "compliance.manage", "report.export", "runtime.emergency"];

describe("validateRoleInput", () => {
  it("normalizes a valid role", () => {
    const r = validateRoleInput({ name: "  Compliance   Reviewer ", description: " Reviews evidence. ", permissions: ["compliance.read", "agent.read", "agent.read"] }, CATALOG);
    expect(r.ok && r.value).toEqual({ name: "Compliance Reviewer", description: "Reviews evidence.", permissions: ["agent.read", "compliance.read"] });
  });
  it("names every problem, and refuses invented permissions", () => {
    const r = validateRoleInput({ name: "x", description: "", permissions: ["god.mode"] }, CATALOG);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(Object.keys(r.errors).sort()).toEqual(["description", "name", "permissions"]);
      expect(r.errors.permissions).toContain("god.mode");
    }
    const empty = validateRoleInput({ name: "Empty Role", description: "Nothing", permissions: [] }, CATALOG);
    expect(!empty.ok && empty.errors.permissions).toMatch(/at least one/);
    expect(validateRoleInput({ name: "<script>", description: "x", permissions: ["agent.read"] }, CATALOG).ok).toBe(false);
  });
});

describe("escalationIn", () => {
  it("allows only permissions the designer holds to be added", () => {
    expect(escalationIn(["agent.read", "runtime.emergency"], [], ["agent.read"])).toEqual(["runtime.emergency"]);
    expect(escalationIn(["agent.read"], [], ["agent.read"])).toEqual([]);
  });
  it("lets a role keep what it had, and lets anyone remove", () => {
    expect(escalationIn(["agent.read", "runtime.emergency"], ["runtime.emergency"], ["agent.read"])).toEqual([]);
    expect(escalationIn([], ["runtime.emergency"], [])).toEqual([]);
  });
});

describe("moduleSummary and permissionDiff", () => {
  it("counts per module and reports changes", () => {
    const catalog = [
      { key: "agent.read", module: "DISCOVER" as const },
      { key: "agent.create", module: "DISCOVER" as const },
      { key: "runtime.read", module: "PROTECT" as const },
    ];
    const s = moduleSummary(["agent.read"], catalog);
    expect(s.find((m) => m.module === "DISCOVER")).toEqual({ module: "DISCOVER", granted: 1, total: 2 });
    expect(s.find((m) => m.module === "PROTECT")).toEqual({ module: "PROTECT", granted: 0, total: 1 });
    expect(permissionDiff(["a", "b"], ["b", "c"])).toEqual({ added: ["a"], removed: ["c"] });
  });
});
