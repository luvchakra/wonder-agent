import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/rbac/requirePermission";
import { FileImportInvalidError, checkImportForm, importFileForObject, tooLargeForImport } from "@/modules/integrations/service";
import { errorResponse } from "@/modules/integrations/http";

/**
 * POST /api/v1/imports — import a CSV from an object page, through the
 * connector framework (non-negotiable #20). multipart/form-data:
 * `kind` (identity | account | entitlement | access_grant | application)
 * and `file` (CSV, at most 10 MB).
 *
 * The file is checked (header row, the columns the kind needs, every
 * row's field count) before it is stored; a refused file answers 400 with
 * `details: [{ row, column, message }]`. Otherwise it becomes an upload of
 * the tenant's "File imports" connection, whose sync reads it: before the
 * response for up to 5,000 rows, in the background above that. 202 with
 * the job to follow: { jobId, integrationId, rows }.
 *
 * Requires integration.execute, the permission that runs a sync.
 */
export const maxDuration = 300;

export async function POST(request: Request) {
  try {
    const ctx = await requirePermission("integration.execute");
    if (tooLargeForImport(request.headers.get("content-length"))) {
      return NextResponse.json({ ok: false, error: { code: "PAYLOAD_TOO_LARGE", message: "file: larger than 10 MB", details: [] } }, { status: 413 });
    }
    let form: FormData;
    try {
      form = await request.formData();
    } catch {
      throw new FileImportInvalidError("Send multipart/form-data with kind and file");
    }
    const { kind } = checkImportForm(form.get("kind"), form.get("file"));
    const file = form.get("file") as File;
    const result = await importFileForObject(ctx, kind, file.name || null, await file.text());
    return NextResponse.json(
      { ok: true, data: { jobId: result.jobId, integrationId: result.integrationId, rows: result.rows, sync: result.sync } },
      { status: 202, headers: { "Cache-Control": "no-store" } },
    );
  } catch (err) {
    if (err instanceof FileImportInvalidError) {
      return NextResponse.json({ ok: false, error: { code: err.code, message: err.message, details: err.details } }, { status: 400 });
    }
    return errorResponse(err);
  }
}
