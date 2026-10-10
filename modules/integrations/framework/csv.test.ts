// @vitest-environment node
import { describe, expect, it } from "vitest";
import { checkColumns, csvRecords, MAX_CSV_BYTES, normalizeColumn, parseColumnRenames, parseCsv, readCsvFile } from "./csv";
import { csvFile } from "./definitions/csv-file";
import type { ResourceSpec } from "./types";

const identity = csvFile.resources.identity as ResourceSpec;
const grant = csvFile.resources.access_grant as ResourceSpec;

describe("parseCsv (RFC 4180)", () => {
  it("reads a header and rows", () => {
    const { table, issues } = parseCsv("id,name\n1,Ada\n2,Grace\n");
    expect(issues).toEqual([]);
    expect(table?.headers).toEqual(["id", "name"]);
    expect(table?.rows).toEqual([
      { row: 2, values: ["1", "Ada"] },
      { row: 3, values: ["2", "Grace"] },
    ]);
  });

  it("keeps separators, line breaks and doubled quotes inside quoted fields", () => {
    const { table } = parseCsv('id,title,notes\n1,"Lovelace, Ada","line one\nline two"\n2,"say ""hi""",x');
    expect(table?.rows[0].values).toEqual(["1", "Lovelace, Ada", "line one\nline two"]);
    expect(table?.rows[1]).toEqual({ row: 3, values: ["2", 'say "hi"', "x"] });
  });

  it("handles a byte-order mark, CRLF and CR line ends, and no final newline", () => {
    expect(parseCsv("﻿id,name\r\n1,Ada\r\n2,Grace").table?.headers).toEqual(["id", "name"]);
    expect(parseCsv("﻿id,name\r\n1,Ada\r\n2,Grace").table?.rows.map((r) => r.values[1])).toEqual(["Ada", "Grace"]);
    expect(parseCsv("id,name\r1,Ada\r2,Grace\r").table?.rows).toHaveLength(2);
    expect(parseCsv('id,notes\r\n1,"a\r\nb"\r\n').table?.rows[0].values[1]).toBe("a\r\nb");
  });

  it("skips blank lines but counts them as rows, as a spreadsheet does", () => {
    const { table } = parseCsv("id\n1\n\n3\n\n");
    expect(table?.rows).toEqual([
      { row: 2, values: ["1"] },
      { row: 4, values: ["3"] },
    ]);
  });

  it("trims unquoted fields and keeps quoted whitespace", () => {
    expect(parseCsv('a,b\n  x  , "  y  " ').table?.rows[0].values).toEqual(["x", "  y  "]);
  });

  it("keeps empty fields", () => {
    expect(parseCsv("a,b,c\n1,,\n").table?.rows[0].values).toEqual(["1", "", ""]);
  });

  it("refuses an unterminated quote, text after a closing quote, and a ragged row, saying where", () => {
    expect(parseCsv('id,name\n1,"Ada\n2,Grace').issues[0]).toMatchObject({ row: 2, message: expect.stringMatching(/never closed/) });
    expect(parseCsv('id,name\n1,"Ada"x\n').issues[0]).toMatchObject({ row: 2, message: expect.stringMatching(/after a closing quote/) });
    expect(parseCsv("id,name\n1,Ada\n2\n").issues).toEqual([{ row: 3, message: "has 1 fields; the header has 2" }]);
  });

  it("refuses an empty file, an unnamed column and duplicate columns", () => {
    expect(parseCsv("").issues[0].message).toMatch(/empty/);
    expect(parseCsv("\n\n").issues[0].message).toMatch(/empty/);
    expect(parseCsv("id,,name\n1,2,3").issues[0]).toMatchObject({ row: 1, message: "a column has no name" });
    expect(parseCsv("Email,e-mail,EMAIL\nx,y,z").issues.map((i) => i.column)).toEqual(["e-mail", "EMAIL"]);
  });

  it("caps the number of rows", () => {
    expect(parseCsv("id\n1\n2\n3\n", { maxRows: 2 }).issues[0].message).toMatch(/more than 2 rows/);
    expect(parseCsv("id\n1\n2\n", { maxRows: 2 }).issues).toEqual([]);
  });

  it("reads another separator", () => {
    expect(parseCsv('a;b\n"1;2";3', { delimiter: ";" }).table?.rows[0].values).toEqual(["1;2", "3"]);
  });
});

describe("columns", () => {
  it("normalizes names: case, spaces, _ and - do not matter", () => {
    expect(["External ID", "external_id", "EXTERNAL-ID", " externalId "].map(normalizeColumn)).toEqual(Array(4).fill("externalid"));
  });

  it("reads renames for this kind, or for every kind", () => {
    const renames = parseColumnRenames("identity.email = Work Email; account.username = Login\nexternalId=Staff No", "identity");
    expect([...renames]).toEqual([
      ["workemail", "email"],
      ["staffno", "externalid"],
    ]);
  });

  it("maps rows to records keyed by column, without empty cells", () => {
    const { table } = parseCsv("Staff No,Work Email,Title\n7,ADA@X.TEST,");
    expect(csvRecords(table!, parseColumnRenames("externalId = Staff No", "identity"))).toEqual([{ _row: 2, externalid: "7", workemail: "ADA@X.TEST" }]);
  });

  it("finds a column for every required field, by name or alternative", () => {
    expect(checkColumns("identity", identity, ["Employee ID", "Email"], new Map())).toEqual([]);
    expect(checkColumns("identity", identity, ["Email"], new Map())[0]).toMatchObject({ row: 1, column: "externalId" });
    expect(checkColumns("identity", identity, ["Staff No"], parseColumnRenames("externalId=Staff No", "identity"))).toEqual([]);
    expect(checkColumns("access_grant", grant, ["Account External ID", "Entitlement External ID"], new Map())).toEqual([]);
    expect(checkColumns("access_grant", grant, ["account"], new Map()).map((i) => i.column)).toEqual(["externalId", "accountExternalId", "entitlementExternalId"]);
  });

  it("checks a whole file: size, structure, then columns", () => {
    expect(readCsvFile("identity", identity, "x".repeat(MAX_CSV_BYTES + 1), undefined).issues[0].message).toMatch(/larger than 10 MB/);
    expect(readCsvFile("identity", identity, "name\nAda", undefined).issues[0].column).toBe("externalId");
    expect(readCsvFile("identity", identity, "id,email\n1,a@x", undefined)).toEqual({ records: [{ _row: 2, id: "1", email: "a@x" }], issues: [] });
  });
});
