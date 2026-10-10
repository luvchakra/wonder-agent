import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/rbac/requirePermission";
import { FileImportInvalidError, IMPORT_MANAGE_PERMISSION, checkImportForm, importScope, previewFileForObject, tooLargeForImport } from "@/modules/integrations/service";
import { errorResponse } from "@/modules/integrations/http";

/**
 * POST /api/v1/imports/preview — what importing a CSV on an object page
 * would do, before anything is stored or changed. The same form as POST
 * /api/v1/imports. 200 { kind, rows, counts: { new, update, unchanged,
 * invalid, review }, columns, shown: [{ row, externalId, decision, values,
 * changes, note }] } with at most 500 rows shown (problems first); the
 * counts cover the whole file. 400 with `details` for a refused file.
 *
 * Requires the same permissions as the import itself.
 */
export const maxDuration = 60;

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
    const preview = await previewFileForObject(ctx, kind, importScope(form.get("scope")), await file.text());
    return NextResponse.json({ ok: true, data: preview }, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    if (err instanceof FileImportInvalidError) {
      return NextResponse.json({ ok: false, error: { code: err.code, message: err.message, details: err.details } }, { status: 400 });
    }
    return errorResponse(err);
  }
}
