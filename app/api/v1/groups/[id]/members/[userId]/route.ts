import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/rbac/requirePermission";
import { errorResponse } from "@/lib/shared/apiError";
import { removeGroupMember } from "@/lib/users/groups";

// FOUNDATION-P0-26 — DELETE removes the member; they lose the group's
// roles on their next request.
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string; userId: string }> }) {
  try {
    const ctx = await requirePermission("groups.manage_members");
    const { id, userId } = await params;
    await removeGroupMember(ctx.tenantId!, ctx.userId, id, userId);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return errorResponse(err);
  }
}
