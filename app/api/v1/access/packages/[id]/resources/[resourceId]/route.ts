import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/rbac/requirePermission";
import { removePackageResource } from "@/modules/access-governance/service";
import { errorResponse } from "@/modules/access-governance/http";

/** ACCESS-P0-20 — take something out of a package (waiting requests for it then need approval again). */
export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string; resourceId: string }> }) {
  try {
    const ctx = await requirePermission("access.manage");
    const { id, resourceId } = await params;
    await removePackageResource(ctx.tenantId!, ctx.userId, id, resourceId);
    return NextResponse.json({ ok: true, data: { removed: resourceId } });
  } catch (err) {
    return errorResponse(err);
  }
}
