import { describe, expect, it } from "vitest";
import { CODE128_PATTERNS, code128B, code128BValues } from "./barcode";

describe("code128B", () => {
  it("has 107 symbols of 11 modules, and a 13-module stop", () => {
    expect(CODE128_PATTERNS).toHaveLength(107);
    CODE128_PATTERNS.slice(0, 106).forEach((p) => expect([...p].reduce((s, d) => s + Number(d), 0)).toBe(11));
    expect([...CODE128_PATTERNS[106]].reduce((s, d) => s + Number(d), 0)).toBe(13);
  });

  it("encodes start B, the characters and the checksum", () => {
    // R=50 E=37 Q=49 0=16 1=17; checksum (104 + 50·1 + 37·2 + 49·3 + 16·(4+…+11) + 17·12) mod 103.
    const values = code128BValues("REQ000000001");
    expect(values.slice(0, 4)).toEqual([104, 50, 37, 49]);
    expect(values).toHaveLength(14);
    expect(values[13]).toBe((104 + 50 + 74 + 147 + 16 * (4 + 5 + 6 + 7 + 8 + 9 + 10 + 11) + 17 * 12) % 103);
  });

  it("returns alternating bar and space widths ending in the stop bar", () => {
    const w = code128B("REQ000000001");
    expect(w).toHaveLength(14 * 6 + 7);
    expect(w.reduce((s, d) => s + d, 0)).toBe(14 * 11 + 13);
    expect(w.slice(0, 6)).toEqual([2, 1, 1, 2, 1, 4]);
    expect(w.slice(-7)).toEqual([2, 3, 3, 1, 1, 1, 2]);
  });

  it("refuses text outside printable ASCII", () => {
    expect(() => code128B("REQ\n1")).toThrow();
    expect(() => code128B("RÉQ")).toThrow();
  });
});
