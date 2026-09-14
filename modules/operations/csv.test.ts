// @vitest-environment node
import { describe, expect, it } from "vitest";
import { toCsv } from "./csv";

describe("toCsv — OPERATIONS-P0-01.2/04.1 export", () => {
  it("returns an empty string for no rows", () => {
    expect(toCsv([])).toBe("");
  });

  it("emits a header row from the first row's keys, then one line per row", () => {
    const csv = toCsv([
      { a: 1, b: "x" },
      { a: 2, b: "y" },
    ]);
    expect(csv).toBe("a,b\n1,x\n2,y");
  });

  it("quotes and escapes values containing commas, quotes or newlines", () => {
    const csv = toCsv([{ note: 'has "quotes", a comma, and\na newline' }]);
    expect(csv).toBe('note\n"has ""quotes"", a comma, and\na newline"');
  });

  it("renders null/undefined as an empty field", () => {
    const csv = toCsv([{ a: null, b: undefined }]);
    expect(csv).toBe("a,b\n,");
  });
});
