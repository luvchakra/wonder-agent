import { describe, expect, it } from "vitest";
import { IMPORT_FILE_MAX_BYTES, checkImportFile, describeIssue, importResponseState } from "./importCsv";

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

describe("importResponseState — never claims success before a 202", () => {
  it("202 with a row count is 'started', not finished", () => {
    expect(importResponseState(202, { data: { jobId: "j1", integrationId: "i1", rows: 42 } })).toEqual({ kind: "started", jobId: "j1", rows: 42 });
  });

  it("202 without a row count is treated as a failure, not a success", () => {
    expect(importResponseState(202, { data: {} }).kind).toBe("failed");
    expect(importResponseState(202, null).kind).toBe("failed");
  });

  it("200 or 201 is not the contract's answer and is not shown as started", () => {
    expect(importResponseState(200, { data: { rows: 3 } }).kind).toBe("failed");
  });

  it("400 shows the message and at most five details", () => {
    const details = Array.from({ length: 7 }, (_, i) => ({ row: i + 2, column: "email", message: "Invalid e-mail" }));
    const s = importResponseState(400, { error: { code: "INVALID_CSV", message: "7 rows have problems", details } });
    expect(s).toMatchObject({ kind: "invalid", message: "7 rows have problems", more: 2 });
    if (s.kind !== "invalid") throw new Error("unexpected");
    expect(s.details).toHaveLength(5);
    expect(describeIssue(s.details[0]!)).toBe("Row 2, column email: Invalid e-mail");
  });

  it("400 drops malformed details and falls back to a generic message", () => {
    const s = importResponseState(400, { error: { details: [{ row: "x" }, { message: "Missing header externalId", column: null, row: null }] } });
    expect(s).toEqual({ kind: "invalid", message: "The file could not be imported.", details: [{ row: null, column: null, message: "Missing header externalId" }], more: 0 });
  });

  it("other statuses are failures carrying the server's message", () => {
    expect(importResponseState(403, { error: { code: "FORBIDDEN", message: "Missing permission" } })).toEqual({ kind: "failed", message: "Missing permission" });
    expect(importResponseState(500, null)).toEqual({ kind: "failed", message: "Import failed (HTTP 500)." });
  });
});
