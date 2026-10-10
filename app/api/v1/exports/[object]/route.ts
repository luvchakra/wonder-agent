import { requirePermission } from "@/lib/rbac/requirePermission";
import { ApiError } from "@/lib/shared/types/foundation";
import { errorResponse } from "@/modules/operations/http";
import { EXPORT_PERMISSION, getExportEntry } from "@/modules/operations/exportRegistry";
import { exportResponse, templateResponse } from "@/modules/operations/exports";

/**
 * GET /api/v1/exports/:object — the object page's "Export CSV" (2026-10-10).
 * The tenant comes only from the session (requirePermission →
 * getTenantContext); the caller needs the page's own read permission and
 * `report.export`. `?template=1` returns the import template's header row
 * and needs only the read permission (it holds no data).
 */
export async function GET(request: Request, { params }: { params: Promise<{ object: string }> }) {
  try {
    const { object } = await params;
    const entry = getExportEntry(object);
    if (!entry) throw new ApiError(404, "NOT_FOUND", "Unknown export");
    const url = new URL(request.url);
    if (url.searchParams.get("template") === "1") {
      await requirePermission(entry.permission);
      return templateResponse(entry);
    }
    await requirePermission(EXPORT_PERMISSION);
    const ctx = await requirePermission(entry.permission);
    return await exportResponse(ctx, entry, url.searchParams);
  } catch (err) {
    return errorResponse(err);
  }
}
