import { describe, expect, it } from "vitest";
import { isHelpPath, safeReturnTo } from "./returnTo";

describe("isHelpPath", () => {
  it("matches the help guide only", () => {
    expect(isHelpPath("/help")).toBe(true);
    expect(isHelpPath("/help/anything")).toBe(true);
    expect(isHelpPath("/helpful")).toBe(false);
    expect(isHelpPath("/settings")).toBe(false);
  });
});

describe("safeReturnTo", () => {
  it("accepts help paths with a query or anchor", () => {
    expect(safeReturnTo("/help")).toBe("/help");
    expect(safeReturnTo("/help?q=reviews")).toBe("/help?q=reviews");
    expect(safeReturnTo("/help#access-requests")).toBe("/help#access-requests");
  });

  it("refuses other sites, other pages and odd input", () => {
    for (const bad of [null, undefined, "", "https://evil.example/help", "//evil.example/help", "/\\evil.example", "/settings", "/helpful", "help", `/help?${"x".repeat(600)}`]) {
      expect(safeReturnTo(bad)).toBeNull();
    }
  });
});
