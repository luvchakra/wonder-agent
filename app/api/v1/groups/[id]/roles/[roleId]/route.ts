import { NextResponse } from "next/server";
import { requireAnyPermission } from "@/lib/rbac/requirePermission";
import { errorResponse } from "@/lib/shared/apiError";
import { removeGroupRole } from "@/lib/users/groups";

// FOUNDATION-P0-26 — DELETE takes the role away from the group.
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string; roleId: string }> }) {
  try {
    const ctx = await requireAnyPermission(["roles.assign", "role.manage"]);
    const { id, roleId } = await params;
    await removeGroupRole(ctx.tenantId!, ctx.userId, id, roleId);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return errorResponse(err);
  }
}
