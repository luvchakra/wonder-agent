import { describe, expect, it } from "vitest";
import { CSV_BOM, csvCell, csvRow, exportFilename } from "./csvWriter";

describe("csvWriter — object-page CSV export", () => {
  it("writes empty cells for null and undefined", () => {
    expect(csvCell(null)).toBe("");
    expect(csvCell(undefined)).toBe("");
  });

  it("quotes commas, quotes, CR and LF per RFC 4180", () => {
    expect(csvCell("a,b")).toBe('"a,b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell("line1\nline2")).toBe('"line1\nline2"');
    expect(csvCell("a\rb")).toBe('"a\rb"');
    expect(csvCell("plain")).toBe("plain");
  });

  it("prefixes formula-looking text with a single quote", () => {
    expect(csvCell("=HYPERLINK(\"http://x\")")).toBe("\"'=HYPERLINK(\"\"http://x\"\")\"");
    expect(csvCell("+1")).toBe("'+1");
    expect(csvCell("-2+3")).toBe("'-2+3");
    expect(csvCell("@SUM(A1)")).toBe("'@SUM(A1)");
    expect(csvCell("\tcmd")).toBe("'\tcmd");
    expect(csvCell("\rcmd")).toBe("\"'\rcmd\"");
    expect(csvCell("a=b")).toBe("a=b");
  });

  it("writes numbers and booleans as they are, without the guard", () => {
    expect(csvCell(-5)).toBe("-5");
    expect(csvCell(0.5)).toBe("0.5");
    expect(csvCell(Number.NaN)).toBe("");
    expect(csvCell(true)).toBe("true");
    expect(csvCell(false)).toBe("false");
  });

  it("joins arrays and serializes objects, guarding the result", () => {
    expect(csvCell(["a", "b"])).toBe("a; b");
    expect(csvCell({ k: 1 })).toBe('"{""k"":1}"');
    expect(csvCell(["=x"])).toBe("'=x");
  });

  it("ends rows with CRLF and starts files with a UTF-8 BOM", () => {
    expect(csvRow(["a", 1, null, "b,c"])).toBe('a,1,,"b,c"\r\n');
    expect(CSV_BOM).toBe("﻿");
    expect(Array.from(new TextEncoder().encode(CSV_BOM))).toEqual([0xef, 0xbb, 0xbf]);
  });

  it("names the file after the object and the date", () => {
    expect(exportFilename("agents", new Date("2026-10-10T12:00:00Z"))).toBe("agents-2026-10-10.csv");
  });
});
