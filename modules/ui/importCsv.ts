/**
 * The "Import CSV…" dialog's pure logic (2026-10-10): checking the chosen
 * file before upload, and turning the import endpoint's answer into what
 * the dialog shows. Truthful states only (CLAUDE.md §17.5): a 202 means the
 * import job *started*, never that it finished; anything else is a failure.
 *
 * Contract (POST /api/v1/imports, owned by the Integration Agent):
 *   202 { data: { jobId, integrationId, rows } }
 *   400 { error: { code, message, details?: [{ row, column, message }] } }
 */

export const IMPORT_FILE_MAX_BYTES = 10 * 1024 * 1024;
export const IMPORT_DETAILS_SHOWN = 5;

export type ImportIssue = { row: number | null; column: string | null; message: string };

export type ImportUiState =
  | { kind: "idle" }
  | { kind: "uploading" }
  | { kind: "started"; jobId: string | null; integrationId: string | null; rows: number; synced: boolean }
  | { kind: "invalid"; message: string; details: ImportIssue[]; more: number }
  | { kind: "failed"; message: string };

/** null when the file may be uploaded, else the reason it may not. */
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

export function importResponseState(status: number, body: unknown): ImportUiState {
  if (status === 202) {
    const data = obj(obj(body)?.data);
    const rows = data?.rows;
    if (data && typeof rows === "number" && Number.isFinite(rows)) {
      return {
        kind: "started",
        jobId: typeof data.jobId === "string" ? data.jobId : null,
        integrationId: typeof data.integrationId === "string" ? data.integrationId : null,
        rows,
        // Only an explicit "completed" counts as synced; anything else is still running.
        synced: data.sync === "completed",
      };
    }
    return { kind: "failed", message: "The import service gave an unexpected answer. Check Jobs before trying again." };
  }
  if (status === 400) {
    const raw = obj(obj(body)?.error)?.details;
    const all: ImportIssue[] = Array.isArray(raw)
      ? raw.flatMap((d) => {
          const o = obj(d);
          if (!o || typeof o.message !== "string") return [];
          return [{ row: typeof o.row === "number" ? o.row : null, column: typeof o.column === "string" ? o.column : null, message: o.message }];
        })
      : [];
    return {
      kind: "invalid",
      message: errorMessage(body) ?? "The file could not be imported.",
      details: all.slice(0, IMPORT_DETAILS_SHOWN),
      more: Math.max(0, all.length - IMPORT_DETAILS_SHOWN),
    };
  }
  return { kind: "failed", message: errorMessage(body) ?? `Import failed (HTTP ${status}).` };
}

export function describeIssue(issue: ImportIssue): string {
  const where = [issue.row !== null ? `Row ${issue.row}` : null, issue.column ? `column ${issue.column}` : null].filter(Boolean).join(", ");
  return where ? `${where}: ${issue.message}` : issue.message;
}
