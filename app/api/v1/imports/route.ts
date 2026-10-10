import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/rbac/requirePermission";
import { FileImportInvalidError, IMPORT_MANAGE_PERMISSION, checkImportForm, importFileForObject, importScope, tooLargeForImport } from "@/modules/integrations/service";
import { errorResponse } from "@/modules/integrations/http";

/**
 * POST /api/v1/imports — import a CSV from an object page, after its
 * preview (POST /api/v1/imports/preview), through the connector framework
 * (non-negotiable #20). multipart/form-data: `kind` (identity | account |
 * entitlement | access_grant | application), `file` (CSV, at most 10 MB and
 * 5,000 rows) and, for identities, the page's `scope`.
 *
 * The file becomes an upload of the tenant's "File imports" connection,
 * whose sync reads and stores it; what it stored is then applied by the
 * module that owns the records. Additive only: records are added or
 * updated, and nothing missing from the file is removed or deactivated.
 * 200 { jobId, integrationId, rows, counts: { created, updated, unchanged,
 * skipped, failed }, problems: [{ row, externalId, message }] }; 400 with
 * `details` for a refused file; 502 when the connection could not read it
 * (nothing was added).
 *
 * Requires integration.execute (it runs a sync) and the page's manage
 * permission (identity.manage or access.manage).
 */
export const maxDuration = 300;

export async function POST(request: Request) {
  try {
    await requirePermission("integration.execute");
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
    const ctx = await requirePermission(IMPORT_MANAGE_PERMISSION[kind]);
    const file = form.get("file") as File;
    const result = await importFileForObject(ctx, kind, importScope(form.get("scope")), file.name || null, await file.text());
    return NextResponse.json(
      { ok: true, data: { jobId: result.jobId, integrationId: result.integrationId, rows: result.rows, counts: result.counts, problems: result.problems } },
      { status: 200, headers: { "Cache-Control": "no-store" } },
    );
  } catch (err) {
    if (err instanceof FileImportInvalidError) {
      return NextResponse.json({ ok: false, error: { code: err.code, message: err.message, details: err.details } }, { status: 400 });
    }
    return errorResponse(err);
  }
}
