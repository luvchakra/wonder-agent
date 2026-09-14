import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/rbac/requirePermission";
import { revokeAccessGrant } from "@/modules/access-governance/service";
import { errorResponse } from "@/modules/access-governance/http";

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requirePermission("access.manage");
    const { id } = await params;
    await revokeAccessGrant(ctx.tenantId!, ctx.userId, id);
    return NextResponse.json({ ok: true, data: null });
  } catch (err) {
    return errorResponse(err);
  }
}
