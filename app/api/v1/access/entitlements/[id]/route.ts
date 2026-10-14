import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/rbac/requirePermission";
import { deleteEntitlement, updateEntitlement } from "@/modules/access-governance/service";
import { errorResponse } from "@/modules/access-governance/http";

/**
 * Owner feedback 2026-10-14 — edit, disable or enable an entitlement
 * (`{ name?, displayName?, description?, entitlementType?, privilegeLevel?,
 * dataClassification?, riskLevel?, requestable?, certifiable?, soxRelevant?,
 * status? }`), or delete one added by hand that was never granted.
 */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requirePermission("access.manage");
    const { id } = await params;
    const body = (await request.json().catch(() => null)) ?? {};
    return NextResponse.json({ ok: true, data: await updateEntitlement(ctx.tenantId!, ctx.userId, id, body) });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requirePermission("access.manage");
    const { id } = await params;
    await deleteEntitlement(ctx.tenantId!, ctx.userId, id);
    return NextResponse.json({ ok: true, data: { id, deleted: true } });
  } catch (err) {
    return errorResponse(err);
  }
}
