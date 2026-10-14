import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/rbac/requirePermission";
import { updateEntitlementType } from "@/modules/access-governance/service";
import { errorResponse } from "@/modules/access-governance/http";

// ACCESS-P0-33 — changes one entitlement type's settings (a connector's type keeps its name).
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string; typeId: string }> }) {
  try {
    const ctx = await requirePermission("access.manage");
    const { id, typeId } = await params;
    const body = (await request.json().catch(() => null)) ?? {};
    return NextResponse.json({ ok: true, data: await updateEntitlementType(ctx.tenantId!, ctx.userId, id, typeId, body) });
  } catch (err) {
    return errorResponse(err);
  }
}
