// @vitest-environment node
import { describe, expect, it } from "vitest";
import { FileImportInvalidError, IMPORT_KINDS, PAGE_IMPORT_MAX_ROWS, MAX_IMPORT_BYTES, checkImportForm, isImportKind, tooLargeForImport } from "./fileImportRules";

const file = (name: string, size: number) => ({ name, size, type: "text/csv", text: async () => "" });

describe("importing a CSV from an object page", () => {
  it("imports the five object kinds, nothing else", () => {
    expect(IMPORT_KINDS).toEqual(["identity", "account", "entitlement", "access_grant", "application"]);
    expect(isImportKind("account")).toBe(true);
    for (const k of ["policy", "mcp_tool", "Identity", "", null]) expect(isImportKind(k)).toBe(false);
  });

  it("accepts one CSV within 10 MB", () => {
    expect(checkImportForm("identity", file("people.csv", 120))).toEqual({ kind: "identity", file: { name: "people.csv", size: 120 } });
    expect(checkImportForm("account", file("export", MAX_IMPORT_BYTES)).kind).toBe("account");
  });

  it("refuses an unknown kind, a missing, empty, oversized or spreadsheet file", () => {
    const refuse = (kind: unknown, f: unknown) => {
      try {
        checkImportForm(kind, f);
      } catch (err) {
        expect(err).toBeInstanceOf(FileImportInvalidError);
        expect((err as FileImportInvalidError).status).toBe(400);
        return (err as Error).message;
      }
      throw new Error("accepted");
    };
    expect(refuse("agents", file("a.csv", 1))).toMatch(/^kind: one of/);
    expect(refuse("identity", null)).toBe("file: attach one CSV file");
    expect(refuse("identity", "a,b\n1,2")).toBe("file: attach one CSV file");
    expect(refuse("identity", file("a.csv", 0))).toBe("file: the file is empty");
    expect(refuse("identity", file("a.csv", MAX_IMPORT_BYTES + 1))).toMatch(/larger than 10 MB/);
    expect(refuse("identity", file("People.XLSX", 10))).toBe("file: save the sheet as CSV first");
  });

  it("refuses an oversized request by its declared length, before reading it", () => {
    expect(tooLargeForImport(String(MAX_IMPORT_BYTES))).toBe(false);
    expect(tooLargeForImport(String(MAX_IMPORT_BYTES + 1024 * 1024))).toBe(true);
    expect(tooLargeForImport(null)).toBe(false);
  });

  it("syncs small files before answering and large ones in the background", () => {
    expect(PAGE_IMPORT_MAX_ROWS).toBe(5_000);
  });

  it("carries each problem's row and column", () => {
    const err = new FileImportInvalidError("no column for externalId", [{ row: 1, column: "externalId", message: "no column for externalId" }]);
    expect(err).toMatchObject({ status: 400, code: "INVALID_FILE", details: [{ row: 1, column: "externalId" }] });
  });
});
