/**
 * The "Import CSV…" dialog's pure logic (2026-10-10): checking the chosen
 * file, reading the preview, and turning the import's answer into what the
 * dialog shows. Truthful states only (CLAUDE.md §17.5): the dialog says
 * records were added or updated only when the import answered with those
 * counts; anything else is a failure.
 *
 * Contract (owned by the Integration Agent):
 *   POST /api/v1/imports/preview → 200 { data: { kind, rows, counts, columns, shown } }
 *   POST /api/v1/imports         → 200 { data: { jobId, integrationId, rows, counts, problems } }
 *   400 { error: { code, message, details?: [{ row, column, message }] } }
 */

export const IMPORT_FILE_MAX_BYTES = 10 * 1024 * 1024;
export const IMPORT_DETAILS_SHOWN = 5;

export type ImportIssue = { row: number | null; column: string | null; message: string };

export type PreviewDecision = "new" | "update" | "unchanged" | "invalid" | "review";
export type PreviewChange = { field: string; from: string | null; to: string | null };
export type PreviewRow = {
  row: number | null;
  externalId: string;
  decision: PreviewDecision;
  values: Record<string, string>;
  changes: PreviewChange[];
  note: string | null;
};
export type ImportPreview = { rows: number; counts: Record<PreviewDecision, number>; columns: string[]; shown: PreviewRow[] };

export type ImportOutcome = {
  rows: number;
  counts: { created: number; updated: number; unchanged: number; skipped: number; failed: number };
  problems: { row: number | null; externalId: string; message: string }[];
};

export type ImportUiState =
  | { kind: "idle" }
  | { kind: "previewing" }
  | { kind: "preview"; preview: ImportPreview }
  | { kind: "importing"; preview: ImportPreview }
  | { kind: "done"; outcome: ImportOutcome }
  | { kind: "invalid"; message: string; details: ImportIssue[]; more: number }
  | { kind: "failed"; message: string };

/** null when the file may be sent, else the reason it may not. */
export function checkImportFile(file: { name: string; size: number } | null | undefined): string | null {
  if (!file) return "Choose a CSV file.";
  if (!/\.csv$/i.test(file.name)) return "The file must be a .csv file.";
  if (file.size === 0) return "The file is empty.";
  if (file.size > IMPORT_FILE_MAX_BYTES) return "The file is larger than 10 MB.";
  return null;
}

function obj(v: unknown): Record<string, unknown> | null {
  return v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

function errorMessage(body: unknown): string | null {
  const m = obj(obj(body)?.error)?.message;
  return typeof m === "string" && m.trim() ? m : null;
}

const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);
const str = (v: unknown): string | null => (typeof v === "string" ? v : null);
const DECISIONS: readonly PreviewDecision[] = ["new", "update", "unchanged", "invalid", "review"];

/** A refused file (400) or any other failure, for either request. */
function refused(status: number, body: unknown, fallback: string): ImportUiState {
  if (status === 400) {
    const raw = obj(obj(body)?.error)?.details;
    const all: ImportIssue[] = Array.isArray(raw)
      ? raw.flatMap((d) => {
          const o = obj(d);
          if (!o || typeof o.message !== "string") return [];
          return [{ row: typeof o.row === "number" ? o.row : null, column: typeof o.column === "string" ? o.column : null, message: o.message }];
        })
      : [];
    return { kind: "invalid", message: errorMessage(body) ?? fallback, details: all.slice(0, IMPORT_DETAILS_SHOWN), more: Math.max(0, all.length - IMPORT_DETAILS_SHOWN) };
  }
  return { kind: "failed", message: errorMessage(body) ?? `${fallback} (HTTP ${status}).` };
}

export function previewResponseState(status: number, body: unknown): ImportUiState {
  if (status !== 200) return refused(status, body, "The file could not be previewed");
  const data = obj(obj(body)?.data);
  const counts = obj(data?.counts);
  if (!data || !counts || !Array.isArray(data.shown) || !Array.isArray(data.columns)) {
    return { kind: "failed", message: "The import service gave an unexpected answer. Nothing was imported." };
  }
  const shown: PreviewRow[] = data.shown.flatMap((r) => {
    const o = obj(r);
    const decision = o?.decision;
    if (!o || typeof decision !== "string" || !(DECISIONS as readonly string[]).includes(decision)) return [];
    const values = obj(o.values) ?? {};
    return [
      {
        row: typeof o.row === "number" ? o.row : null,
        externalId: str(o.externalId) ?? "",
        decision: decision as PreviewDecision,
        values: Object.fromEntries(Object.entries(values).map(([k, v]) => [k, typeof v === "string" ? v : ""])),
        changes: Array.isArray(o.changes)
          ? o.changes.flatMap((c) => {
              const co = obj(c);
              return co && typeof co.field === "string" ? [{ field: co.field, from: str(co.from), to: str(co.to) }] : [];
            })
          : [],
        note: str(o.note),
      },
    ];
  });
  return {
    kind: "preview",
    preview: {
      rows: num(data.rows),
      counts: { new: num(counts.new), update: num(counts.update), unchanged: num(counts.unchanged), invalid: num(counts.invalid), review: num(counts.review) },
      columns: data.columns.filter((c): c is string => typeof c === "string"),
      shown,
    },
  };
}

export function importResultState(status: number, body: unknown): ImportUiState {
  if (status !== 200) return refused(status, body, "The file could not be imported");
  const data = obj(obj(body)?.data);
  const counts = obj(data?.counts);
  if (!data || !counts || typeof data.rows !== "number") {
    return { kind: "failed", message: "The import service gave an unexpected answer. Refresh the page to see what was imported." };
  }
  return {
    kind: "done",
    outcome: {
      rows: data.rows,
      counts: { created: num(counts.created), updated: num(counts.updated), unchanged: num(counts.unchanged), skipped: num(counts.skipped), failed: num(counts.failed) },
      problems: Array.isArray(data.problems)
        ? data.problems.flatMap((p) => {
            const o = obj(p);
            return o && typeof o.message === "string" ? [{ row: typeof o.row === "number" ? o.row : null, externalId: str(o.externalId) ?? "", message: o.message }] : [];
          })
        : [],
    },
  };
}

export function describeIssue(issue: ImportIssue): string {
  const where = [issue.row !== null ? `Row ${issue.row}` : null, issue.column ? `column ${issue.column}` : null].filter(Boolean).join(", ");
  return where ? `${where}: ${issue.message}` : issue.message;
}

const LABELS: Record<string, string> = {
  externalId: "External ID",
  displayName: "Name",
  identityType: "Type",
  businessUnit: "Business unit",
  employmentType: "Employment type",
  managerExternalId: "Manager",
  startDate: "Start date",
  endDate: "End date",
  privilegeLevel: "Privilege",
  dataClassification: "Data classification",
  accountType: "Account type",
  lastLoginAt: "Last login",
  accountExternalId: "Account",
  entitlementExternalId: "Entitlement",
  grantType: "Grant type",
};

/** "businessUnit" → "Business unit". */
export function columnLabel(key: string): string {
  if (LABELS[key]) return LABELS[key];
  const words = key.replace(/([a-z0-9])([A-Z])/g, "$1 $2").toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

export const DECISION_LABEL: Record<PreviewDecision, string> = {
  new: "New",
  update: "Update",
  unchanged: "No change",
  invalid: "Not imported",
  review: "Needs review",
};

/** Rows the import would write: confirming anything else would do nothing. */
export function importableRows(preview: ImportPreview): number {
  return preview.counts.new + preview.counts.update;
}

/** One line for the result, from the counts the import returned. */
export function outcomeSummary(o: ImportOutcome): string {
  const parts: string[] = [];
  if (o.counts.created) parts.push(`${o.counts.created.toLocaleString()} added`);
  if (o.counts.updated) parts.push(`${o.counts.updated.toLocaleString()} updated`);
  if (o.counts.unchanged) parts.push(`${o.counts.unchanged.toLocaleString()} already up to date`);
  const done = parts.length ? parts.join(", ") : "Nothing was added or updated";
  const notDone = o.counts.skipped + o.counts.failed;
  return notDone ? `${done}. ${notDone.toLocaleString()} ${notDone === 1 ? "row was" : "rows were"} not imported.` : `${done}.`;
}
