import { describe, expect, it } from "vitest";
import { parseRefParam } from "./objectRef";

describe("parseRefParam", () => {
  it("takes a positive whole number as the key", () => {
    expect(parseRefParam("42")).toEqual({ kind: "ref", ref: 42 });
    expect(parseRefParam("1")).toEqual({ kind: "ref", ref: 1 });
  });

  it("takes a UUID from an old link", () => {
    expect(parseRefParam("C8C038DE-7AD5-4719-BAA2-D5129E28B185")).toEqual({ kind: "uuid", id: "c8c038de-7ad5-4719-baa2-d5129e28b185" });
  });

  it("refuses anything else", () => {
    for (const bad of ["0", "-1", "01", "1.5", "1e3", "abc", "", "42; drop", "12345678901234567", "REQ000000042"]) expect(parseRefParam(bad)).toBeNull();
    expect(parseRefParam(undefined)).toBeNull();
    expect(parseRefParam(null)).toBeNull();
  });
});
