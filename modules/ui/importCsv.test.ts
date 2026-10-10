import { describe, expect, it } from "vitest";
import { IMPORT_FILE_MAX_BYTES, checkImportFile, columnLabel, describeIssue, importResultState, importableRows, outcomeSummary, previewResponseState } from "./importCsv";

describe("checkImportFile", () => {
  it("accepts a non-empty .csv up to 10 MB", () => {
    expect(checkImportFile({ name: "people.CSV", size: 10 })).toBeNull();
    expect(checkImportFile({ name: "a.csv", size: IMPORT_FILE_MAX_BYTES })).toBeNull();
  });
  it("refuses a missing, wrong-type, empty or oversized file", () => {
    expect(checkImportFile(null)).toMatch(/Choose/);
    expect(checkImportFile({ name: "a.xlsx", size: 10 })).toMatch(/\.csv/);
    expect(checkImportFile({ name: "a.csv", size: 0 })).toMatch(/empty/);
    expect(checkImportFile({ name: "a.csv", size: IMPORT_FILE_MAX_BYTES + 1 })).toMatch(/10 MB/);
  });
});

const previewBody = {
  data: {
    kind: "identity",
    rows: 3,
    counts: { new: 1, update: 1, unchanged: 0, invalid: 1, review: 0 },
    columns: ["externalId", "displayName", "department"],
    shown: [
      { row: 2, externalId: "E1", decision: "new", values: { externalId: "E1", displayName: "Ada", department: "Ops" }, changes: [], note: null },
      { row: 3, externalId: "E2", decision: "update", values: { externalId: "E2", displayName: "Bo", department: "Fin" }, changes: [{ field: "department", from: "Ops", to: "Fin" }], note: null },
      { row: 4, externalId: "", decision: "invalid", values: {}, changes: [], note: "no value for externalId" },
      { row: 5, decision: "deleted", values: {} },
    ],
  },
};

describe("previewResponseState", () => {
  it("reads the preview and drops rows with an unknown decision", () => {
    const s = previewResponseState(200, previewBody);
    if (s.kind !== "preview") throw new Error(`unexpected ${s.kind}`);
    expect(s.preview.rows).toBe(3);
    expect(s.preview.shown.map((r) => r.decision)).toEqual(["new", "update", "invalid"]);
    expect(s.preview.shown[1]!.changes).toEqual([{ field: "department", from: "Ops", to: "Fin" }]);
    expect(importableRows(s.preview)).toBe(2);
  });

  it("an answer without counts or rows is a failure, never an empty preview", () => {
    expect(previewResponseState(200, { data: {} }).kind).toBe("failed");
    expect(previewResponseState(200, null).kind).toBe("failed");
  });

  it("400 shows the message and at most five details", () => {
    const details = Array.from({ length: 7 }, (_, i) => ({ row: i + 2, column: "email", message: "Invalid e-mail" }));
    const s = previewResponseState(400, { error: { code: "INVALID_FILE", message: "7 rows have problems", details } });
    expect(s).toMatchObject({ kind: "invalid", message: "7 rows have problems", more: 2 });
    if (s.kind !== "invalid") throw new Error("unexpected");
    expect(s.details).toHaveLength(5);
    expect(describeIssue(s.details[0]!)).toBe("Row 2, column email: Invalid e-mail");
  });

  it("400 drops malformed details and falls back to a generic message", () => {
    const s = previewResponseState(400, { error: { details: [{ row: "x" }, { message: "Missing header externalId", column: null, row: null }] } });
    expect(s).toEqual({ kind: "invalid", message: "The file could not be previewed", details: [{ row: null, column: null, message: "Missing header externalId" }], more: 0 });
  });

  it("other statuses are failures carrying the server's message", () => {
    expect(previewResponseState(403, { error: { code: "FORBIDDEN", message: "Missing permission" } })).toEqual({ kind: "failed", message: "Missing permission" });
    expect(previewResponseState(500, null)).toEqual({ kind: "failed", message: "The file could not be previewed (HTTP 500)." });
  });
});

describe("importResultState — says what was done only from the import's own counts", () => {
  it("200 with counts is done", () => {
    const s = importResultState(200, { data: { rows: 3, counts: { created: 1, updated: 1, unchanged: 0, skipped: 1, failed: 0 }, problems: [{ row: 4, externalId: "", message: "no value" }] } });
    if (s.kind !== "done") throw new Error(`unexpected ${s.kind}`);
    expect(outcomeSummary(s.outcome)).toBe("1 added, 1 updated. 1 row was not imported.");
    expect(s.outcome.problems).toEqual([{ row: 4, externalId: "", message: "no value" }]);
  });

  it("an answer without counts is not shown as done", () => {
    expect(importResultState(200, { data: { rows: 3 } }).kind).toBe("failed");
    expect(importResultState(202, { data: { rows: 3, counts: {} } }).kind).toBe("failed");
  });

  it("a connection that could not read the file is a failure with its message", () => {
    expect(importResultState(502, { error: { message: "The File imports connection could not read the file. Nothing was added." } })).toEqual({
      kind: "failed",
      message: "The File imports connection could not read the file. Nothing was added.",
    });
  });

  it("summarises nothing done truthfully", () => {
    expect(outcomeSummary({ rows: 1, counts: { created: 0, updated: 0, unchanged: 1, skipped: 0, failed: 0 }, problems: [] })).toBe("1 already up to date.");
    expect(outcomeSummary({ rows: 2, counts: { created: 0, updated: 0, unchanged: 0, skipped: 1, failed: 1 }, problems: [] })).toBe("Nothing was added or updated. 2 rows were not imported.");
  });
});

describe("columnLabel", () => {
  it("names the page's columns in plain words", () => {
    expect(columnLabel("externalId")).toBe("External ID");
    expect(columnLabel("businessUnit")).toBe("Business unit");
    expect(columnLabel("department")).toBe("Department");
    expect(columnLabel("accountExternalId")).toBe("Account");
  });
});
