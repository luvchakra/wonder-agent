import { CANONICAL_FIELDS, type FieldMapping, type FileSourceSpec, type ResourceKind, type ResourceSpec } from "./types";
import { templateVariables } from "./mapping";

/**
 * CSV for the file driver (RFC 4180): quoted fields with embedded
 * separators, quotes ("") and line breaks; CRLF, LF or CR line ends; a
 * leading byte-order mark. The first row is the header and names the
 * columns. Pure: no I/O, so the receiver, the imports API and the driver
 * all check a file with exactly the same rules.
 *
 * Strict where a lenient parser would guess: an unterminated quote, text
 * after a closing quote, or a row with a different number of fields than
 * the header fails the file and says where, rather than importing rows
 * shifted into the wrong columns.
 */

/** Largest CSV accepted (uploaded, imported or fetched). */
export const MAX_CSV_BYTES = 10 * 1024 * 1024;
/** Rows per file, the same ceiling as one resource of a sync. */
export const MAX_CSV_ROWS = 50_000;

/** `row` is the spreadsheet row: the header is row 1. */
export type CsvIssue = { row: number; column?: string; message: string };

export type CsvTable = { headers: string[]; rows: { row: number; values: string[] }[] };

/** "Work Email", "work_email" and "WORK-EMAIL" are all `workemail`. */
export function normalizeColumn(name: string): string {
  return name.normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
}

export function parseCsv(input: string, opts: { delimiter?: string; maxRows?: number } = {}): { table: CsvTable | null; issues: CsvIssue[] } {
  const sep = opts.delimiter ?? ",";
  const maxRows = opts.maxRows ?? MAX_CSV_ROWS;
  const text = input.charCodeAt(0) === 0xfeff ? input.slice(1) : input;
  const records: { row: number; values: string[] }[] = [];
  let field = "";
  let values: string[] = [];
  let quoted = false; // inside a quoted field
  let wasQuoted = false; // the current field was quoted and has closed
  let line = 1; // physical line, for messages
  let recordLine = 1;
  const issues: CsvIssue[] = [];

  const endField = () => {
    values.push(wasQuoted ? field : field.trim());
    field = "";
    wasQuoted = false;
  };
  let rowCount = 0;
  const endRecord = () => {
    endField();
    rowCount++;
    // A blank line is no record (but still a row, as a spreadsheet counts it).
    if (!(values.length === 1 && values[0] === "")) records.push({ row: rowCount, values });
    values = [];
  };

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          quoted = false;
          wasQuoted = true;
        }
      } else {
        if (c === "\n" || (c === "\r" && text[i + 1] !== "\n")) line++;
        field += c;
      }
      continue;
    }
    if (c === sep) {
      endField();
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      endRecord();
      line++;
      recordLine = line;
      if (records.length > maxRows + 1) break;
    } else if (wasQuoted) {
      if (c === " " || c === "\t") continue;
      return { table: null, issues: [{ row: rowCount + 1, message: `line ${line}: text after a closing quote` }] };
    } else if (c === '"' && field.trim() === "") {
      quoted = true;
      field = "";
    } else {
      field += c;
    }
  }
  if (quoted) return { table: null, issues: [{ row: rowCount + 1, message: `line ${recordLine}: a quoted field is never closed` }] };
  if (field !== "" || values.length > 0 || wasQuoted) endRecord();

  if (records.length === 0) return { table: null, issues: [{ row: 1, message: "the file is empty: the first row must name the columns" }] };
  if (records.length - 1 > maxRows) return { table: null, issues: [{ row: maxRows + 2, message: `more than ${maxRows.toLocaleString("en-US")} rows; split the file` }] };

  const headers = records[0].values;
  const seen = new Map<string, string>();
  headers.forEach((h, i) => {
    const key = normalizeColumn(h);
    if (!key) issues.push({ row: 1, column: h || `column ${i + 1}`, message: "a column has no name" });
    else if (seen.has(key)) issues.push({ row: 1, column: h, message: `same column as "${seen.get(key)}"` });
    else seen.set(key, h);
  });
  for (const r of records.slice(1)) {
    if (issues.length >= 20) break;
    if (r.values.length !== headers.length) issues.push({ row: r.row, message: `has ${r.values.length} fields; the header has ${headers.length}` });
  }
  if (issues.length) return { table: null, issues };
  return { table: { headers, rows: records.slice(1) }, issues: [] };
}

/**
 * Column renames from a connection's setting: `email = Work Email`, or
 * `identity.email = Work Email` for one kind. Lines or `;` separate them.
 * Returns normalized column → normalized field name.
 */
export function parseColumnRenames(text: string | undefined, kind: ResourceKind): Map<string, string> {
  const out = new Map<string, string>();
  for (const entry of (text ?? "").split(/[;\n]/)) {
    const eq = entry.indexOf("=");
    if (eq < 0) continue;
    const target = entry.slice(0, eq).trim();
    const column = normalizeColumn(entry.slice(eq + 1));
    const dot = target.indexOf(".");
    if (dot >= 0 && target.slice(0, dot) !== kind) continue;
    const field = normalizeColumn(dot >= 0 ? target.slice(dot + 1) : target);
    if (field && column) out.set(column, field);
  }
  return out;
}

/** The record keys of a table's columns: normalized names, after renames. */
export function columnKeys(headers: string[], renames: Map<string, string>): string[] {
  return headers.map((h) => {
    const key = normalizeColumn(h);
    return renames.get(key) ?? key;
  });
}

/**
 * The rows as records keyed by column. Empty cells are left out, so a
 * mapping's `default` or a later path applies. `_row` keeps the
 * spreadsheet row for messages.
 */
export function csvRecords(table: CsvTable, renames: Map<string, string> = new Map()): Record<string, unknown>[] {
  const keys = columnKeys(table.headers, renames);
  return table.rows.map(({ row, values }) => {
    const record: Record<string, unknown> = { _row: row };
    keys.forEach((k, i) => {
      if (values[i] !== "") record[k] = values[i];
    });
    return record;
  });
}

/** The first segment of each column a mapping may read (a template's {record.x}, a path or a path list). */
function columnsRead(mapping: FieldMapping): string[] | null {
  if (typeof mapping === "string") return [mapping.split(".")[0]];
  if (mapping.value !== undefined || mapping.default !== undefined) return null; // always has a value
  if (mapping.template !== undefined) {
    return templateVariables(mapping.template)
      .filter((v) => v.startsWith("record."))
      .map((v) => v.slice("record.".length).split(".")[0]);
  }
  const paths = mapping.path === undefined ? [] : Array.isArray(mapping.path) ? mapping.path : [mapping.path];
  return paths.map((p) => p.split(".")[0]);
}

/**
 * Whether a file's columns can fill the kind's required fields, before it
 * is stored: a file that cannot import a single record is refused with the
 * column it lacks, not discovered at the next sync.
 */
export function checkColumns(kind: ResourceKind, spec: ResourceSpec, headers: string[], renames: Map<string, string>): CsvIssue[] {
  const keys = new Set(columnKeys(headers, renames));
  const issues: CsvIssue[] = [];
  for (const field of CANONICAL_FIELDS[kind].required) {
    const mapping = spec.fields[field];
    if (mapping === undefined) continue; // the validator already requires it
    const columns = columnsRead(mapping);
    if (columns === null || columns.some((c) => keys.has(c))) continue;
    issues.push({ row: 1, column: field, message: `no column for ${field} (name one ${columns.map((c) => `"${c}"`).join(" or ")}, in any case)` });
  }
  return issues;
}

/**
 * Parses and checks one file for one kind of a file definition: the
 * receiver and the imports API both refuse a file this rejects, with
 * every issue's row and column.
 */
export function readCsvFile(
  kind: ResourceKind,
  spec: ResourceSpec,
  text: string,
  columns: string | undefined,
): { records: Record<string, unknown>[]; issues: CsvIssue[] } {
  if (Buffer.byteLength(text, "utf8") > MAX_CSV_BYTES) return { records: [], issues: [{ row: 0, message: `the file is larger than ${MAX_CSV_BYTES / 1024 / 1024} MB` }] };
  const { table, issues } = parseCsv(text, { delimiter: delimiterOf(spec.file) });
  if (!table) return { records: [], issues };
  const renames = parseColumnRenames(columns, kind);
  const columnIssues = checkColumns(kind, spec, table.headers, renames);
  if (columnIssues.length) return { records: [], issues: columnIssues };
  return { records: csvRecords(table, renames), issues: [] };
}

export function delimiterOf(file: FileSourceSpec | undefined): string {
  return file?.delimiter ?? ",";
}
