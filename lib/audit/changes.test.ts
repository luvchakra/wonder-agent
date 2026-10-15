import { describe, expect, it } from "vitest";
import { fieldChanges, readFieldChanges } from "./changes";

describe("fieldChanges", () => {
  it("lists only the fields whose value changed, with old and new values", () => {
    const changes = fieldChanges({ name: "Finance", priority: 2, mode: "report_only" }, { name: "Finance Ops", priority: 2, mode: "enforce" });
    expect(changes).toEqual([
      { field: "name", from: "Finance", to: "Finance Ops" },
      { field: "mode", from: "report_only", to: "enforce" },
    ]);
  });

  it("compares objects and arrays by value, whatever the key order", () => {
    expect(fieldChanges({ scope: { a: 1, b: [1, 2] } }, { scope: { b: [1, 2], a: 1 } })).toEqual([]);
    expect(fieldChanges({ permissions: ["a"] }, { permissions: ["a", "b"] })).toEqual([{ field: "permissions", from: ["a"], to: ["a", "b"] }]);
  });

  it("treats missing and null as the same, and a field that was not written as unchanged", () => {
    expect(fieldChanges({ owner: null }, { owner: undefined, expiry: null })).toEqual([]);
    expect(fieldChanges(null, { owner: "u1" })).toEqual([{ field: "owner", from: null, to: "u1" }]);
  });

  it("never records typed text or secret values, only that they changed (WID-H07, #10)", () => {
    const changes = fieldChanges(
      { description: "old words", api_key: "k1", note: "x" },
      { description: "new words", api_key: "k2", note: "x", clientSecret: "s", exception_process: "ask" },
    );
    expect(changes).toEqual([
      { field: "description", omitted: "text" },
      { field: "api_key", omitted: "secret" },
      { field: "clientSecret", omitted: "secret" },
      { field: "exception_process", omitted: "text" },
    ]);
    expect(JSON.stringify(changes)).not.toMatch(/words|k2|"s"|ask/);
  });

  it("skips bookkeeping columns and caller-named fields", () => {
    expect(fieldChanges({ updated_at: "1", version: 1, x: 1 }, { updated_at: "2", version: 2, x: 2 }, { ignore: ["x"] })).toEqual([]);
  });

  it("does not store very long values", () => {
    expect(fieldChanges({ rules: [] }, { rules: Array.from({ length: 500 }, (_, i) => `rule-${i}`) })).toEqual([{ field: "rules", omitted: "too_long" }]);
  });

  it("reads changes back and drops malformed entries", () => {
    expect(readFieldChanges({ changes: [{ field: "a", from: 1, to: 2 }, "junk", { nofield: 1 }] })).toEqual([{ field: "a", from: 1, to: 2 }]);
    expect(readFieldChanges({})).toEqual([]);
  });
});
