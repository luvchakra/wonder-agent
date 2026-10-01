import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/rbac/requirePermission";
import { errorResponse } from "@/lib/shared/apiError";
import { assertUuid } from "@/lib/security/validate";
import { exportForRequest } from "@/modules/privacy/service";

/** The subject's data for an access/portability request, as a JSON download. Audited; never cached. */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requirePermission("privacy.requests.process");
    const id = assertUuid((await params).id, "id");
    const data = await exportForRequest(ctx.tenantId!, ctx.userId, id);
    return new NextResponse(JSON.stringify(data, null, 2), {
      headers: { "Content-Type": "application/json; charset=utf-8", "Content-Disposition": `attachment; filename="subject-export-${id}.json"`, "Cache-Control": "no-store" },
    });
  } catch (err) {
    return errorResponse(err);
  }
}
