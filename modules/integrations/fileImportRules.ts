import { ApiError } from "@/lib/shared/types/foundation";
import { MAX_CSV_BYTES, type CsvIssue } from "./framework/csv";
import type { ResourceKind } from "./framework/types";

/**
 * Pure rules for importing a CSV from an object page (POST /api/v1/imports,
 * importFileForObject). The import runs through the connector framework
 * (non-negotiable #20): the file becomes an upload of the tenant's single
 * "File imports" connection (built-in csv-file) and is read by that
 * connection's sync, exactly as a file sent to its receiver would be.
 */

/** The object pages that import CSV, by the kind of record they hold. */
export const IMPORT_KINDS = ["identity", "account", "entitlement", "access_grant", "application"] as const satisfies readonly ResourceKind[];
export type ImportKind = (typeof IMPORT_KINDS)[number];

export const MAX_IMPORT_BYTES = MAX_CSV_BYTES;
/** Up to this many rows the sync runs before the response; a larger file syncs in the background. */
export const INLINE_SYNC_MAX_ROWS = 5_000;

export const FILE_IMPORTS_PURPOSE = "file_imports";
export const FILE_IMPORTS_NAME = "File imports";

export function isImportKind(value: unknown): value is ImportKind {
  return typeof value === "string" && (IMPORT_KINDS as readonly string[]).includes(value);
}

/** A file the import refuses, with each problem's row and column (row 1 is the header). */
export class FileImportInvalidError extends ApiError {
  constructor(
    message: string,
    readonly details: CsvIssue[] = [],
  ) {
    super(400, "INVALID_FILE", message);
  }
}

/**
 * Checks the multipart form before the file is read: a known kind and one
 * CSV file within the size cap. Returns what to import, or throws.
 */
export function checkImportForm(kind: unknown, file: unknown): { kind: ImportKind; file: { name: string; size: number } } {
  if (!isImportKind(kind)) throw new FileImportInvalidError(`kind: one of ${IMPORT_KINDS.join(", ")}`);
  if (!file || typeof file !== "object" || typeof (file as { size?: unknown }).size !== "number" || typeof (file as { text?: unknown }).text !== "function") {
    throw new FileImportInvalidError("file: attach one CSV file");
  }
  const f = file as { name?: string; size: number; type?: string };
  if (f.size === 0) throw new FileImportInvalidError("file: the file is empty");
  if (f.size > MAX_IMPORT_BYTES) throw new FileImportInvalidError(`file: larger than ${MAX_IMPORT_BYTES / 1024 / 1024} MB`);
  const name = typeof f.name === "string" ? f.name : "";
  // Spreadsheet formats are refused by name, so an .xlsx is not parsed as text.
  if (/\.(xlsx|xls|xlsm|ods|numbers)$/i.test(name)) throw new FileImportInvalidError("file: save the sheet as CSV first");
  return { kind, file: { name, size: f.size } };
}

/** Whether a request's declared length can be refused before its body is read. */
export function tooLargeForImport(contentLength: string | null): boolean {
  const n = Number(contentLength);
  // Multipart adds a boundary and part headers around the file.
  return Number.isFinite(n) && n > MAX_IMPORT_BYTES + 64 * 1024;
}
