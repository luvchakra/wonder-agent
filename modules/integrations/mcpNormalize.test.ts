// @vitest-environment node
import { describe, expect, it } from "vitest";
import { classifyToolOperation } from "./mcpNormalize";

describe("classifyToolOperation (INTEGRATION-P0-06)", () => {
  it("the server's own annotations decide first", () => {
    expect(classifyToolOperation("delete_everything", { readOnlyHint: true })).toEqual({ operation: "read", basis: "annotation", destructive: false });
    expect(classifyToolOperation("get_thing", { readOnlyHint: false })).toEqual({ operation: "write", basis: "annotation", destructive: false });
    expect(classifyToolOperation("x", { destructiveHint: true })).toEqual({ operation: "write", basis: "annotation", destructive: true });
    // Contradictory hints: destructive wins, never "read".
    expect(classifyToolOperation("x", { readOnlyHint: true, destructiveHint: true }).operation).toBe("write");
  });

  it("otherwise the leading verb of the name, in any case style", () => {
    expect(classifyToolOperation("list_customers", undefined)).toMatchObject({ operation: "read", basis: "name" });
    expect(classifyToolOperation("getInvoice", undefined)).toMatchObject({ operation: "read", basis: "name" });
    expect(classifyToolOperation("send-email", undefined)).toMatchObject({ operation: "write", basis: "name", destructive: false });
    expect(classifyToolOperation("delete.customer", undefined)).toMatchObject({ operation: "write", destructive: true });
  });

  it("says unknown rather than guessing", () => {
    expect(classifyToolOperation("customer_magic", undefined)).toEqual({ operation: "unknown", basis: "none", destructive: false });
  });
});
