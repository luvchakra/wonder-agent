/**
 * The object-page CSV export's cell and row writer (2026-10-10). Pure, so
 * it is unit-tested on its own and shared by the export stream and the
 * template download.
 *
 * - RFC 4180: a field holding a comma, a double quote, CR or LF is quoted,
 *   quotes inside it are doubled, and records end with CRLF.
 * - CSV/formula injection (OWASP): a text cell that starts with `=`, `+`,
 *   `-`, `@`, a tab or a carriage return is prefixed with a single quote, so
 *   a spreadsheet shows it as text and never evaluates it. Numbers and
 *   booleans are written as they are; they cannot carry a formula.
 * - The file starts with a UTF-8 byte-order mark so spreadsheet programs
 *   read non-ASCII names correctly.
 */

export const CSV_BOM = "﻿";
export const CSV_EOL = "\r\n";

const FORMULA_START = /^[=+\-@\t\r]/;
const NEEDS_QUOTES = /[",\r\n]/;

export function csvCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "";
  if (typeof value === "boolean") return value ? "true" : "false";
  let text: string;
  if (Array.isArray(value)) text = value.map((v) => (v !== null && typeof v === "object" ? JSON.stringify(v) : String(v ?? ""))).join("; ");
  else if (value instanceof Date) text = value.toISOString();
  else if (typeof value === "object") text = JSON.stringify(value);
  else text = String(value);
  if (FORMULA_START.test(text)) text = `'${text}`;
  return NEEDS_QUOTES.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function csvRow(values: readonly unknown[]): string {
  return values.map(csvCell).join(",") + CSV_EOL;
}

/** `agents-2026-10-10.csv`. The object key is from the registry, never user text. */
export function exportFilename(objectKey: string, now: Date = new Date()): string {
  return `${objectKey}-${now.toISOString().slice(0, 10)}.csv`;
}
