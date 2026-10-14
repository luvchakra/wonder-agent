import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/rbac/requirePermission";
import { revokeDelegation } from "@/modules/access-governance/service";
import { errorResponse } from "@/modules/access-governance/http";

// ACCESS-P0-23 — ends a delegation now: the person away, the delegate, or an access manager.
export async function POST(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requirePermission("access.read");
    const { id } = await params;
    const data = await revokeDelegation(ctx.tenantId!, { userId: ctx.userId, canManageAccess: ctx.permissions.includes("access.manage"), canManageRoles: ctx.permissions.includes("role.manage") }, id);
    return NextResponse.json({ ok: true, data });
  } catch (err) {
    return errorResponse(err);
  }
}
