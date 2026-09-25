// @vitest-environment node
import { describe, expect, it } from "vitest";
import { policyAppliesTo, targetsFromScope, validateTargets } from "./policyTargets";

const req = { action: "DELETE", tool: "delete_customer", mcpServer: "finance-mcp", resource: "CustomerDB.orders", application: "Snowflake" };

describe("policy targets (ACCESS-P0-12)", () => {
  it("no targets: applies to every request", () => {
    expect(policyAppliesTo([], req)).toBe(true);
    expect(policyAppliesTo(undefined, req)).toBe(true);
  });

  it("matches each target type, case-insensitively", () => {
    expect(policyAppliesTo([{ type: "TOOL", value: "Delete_Customer" }], req)).toBe(true);
    expect(policyAppliesTo([{ type: "MCP_SERVER", value: "finance-mcp" }], req)).toBe(true);
    expect(policyAppliesTo([{ type: "MCP_TOOL", value: "finance-mcp:delete_customer" }], req)).toBe(true);
    expect(policyAppliesTo([{ type: "MCP_TOOL", value: "other-mcp:delete_customer" }], req)).toBe(false);
    expect(policyAppliesTo([{ type: "DATA_SOURCE", value: "snowflake" }], req)).toBe(true);
    expect(policyAppliesTo([{ type: "DATA_RESOURCE", value: "CustomerDB.*" }], req)).toBe(true);
    expect(policyAppliesTo([{ type: "DATA_RESOURCE", value: "CustomerDB" }], req)).toBe(false);
    expect(policyAppliesTo([{ type: "ACTION", value: "delete" }], req)).toBe(true);
    expect(policyAppliesTo([{ type: "ACTION", value: "read" }], req)).toBe(false);
  });

  it("applies when any one of several targets matches", () => {
    expect(policyAppliesTo([{ type: "TOOL", value: "export_all" }, { type: "ACTION", value: "delete" }], req)).toBe(true);
    expect(policyAppliesTo([{ type: "TOOL", value: "export_all" }], { action: "READ" })).toBe(false);
  });

  it("stored targets: malformed entries are dropped and never match", () => {
    expect(targetsFromScope({ targets: [{ type: "TOOL", value: "x" }, { type: "EVERYTHING", value: "*" }, "bad"] })).toEqual([{ type: "TOOL", value: "x" }]);
    expect(targetsFromScope(null)).toEqual([]);
  });

  it("validates input at the boundary", () => {
    expect(validateTargets([{ type: "TOOL", value: " delete_customer " }])).toEqual([{ type: "TOOL", value: "delete_customer" }]);
    expect(validateTargets(undefined)).toEqual([]);
    expect(() => validateTargets([{ type: "EVERYTHING", value: "x" }])).toThrow(/type/);
    expect(() => validateTargets([{ type: "TOOL", value: "" }])).toThrow(/value/);
    expect(() => validateTargets([{ type: "MCP_TOOL", value: "no-colon" }])).toThrow(/server/);
    expect(() => validateTargets("TOOL")).toThrow(/list/);
  });
});
