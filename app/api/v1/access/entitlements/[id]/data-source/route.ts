import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/rbac/requirePermission";
import { assertUuid } from "@/lib/security/validate";
import { linkEntitlementToDataSource } from "@/modules/access-governance/service";
import { errorResponse } from "@/modules/access-governance/http";

/** ACCESS-P0-13 — point an entitlement at the data source it opens; `{ dataSourceId: null }` clears it. */
export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requirePermission("access.manage");
    const { id } = await params;
    assertUuid(id, "id");
    const body = (await request.json().catch(() => ({}))) as { dataSourceId?: unknown };
    const dataSourceId = body.dataSourceId === null ? null : String(body.dataSourceId ?? "");
    if (dataSourceId !== null) assertUuid(dataSourceId, "dataSourceId");
    await linkEntitlementToDataSource(ctx.tenantId!, ctx.userId, id, dataSourceId);
    return NextResponse.json({ ok: true, data: { entitlementId: id, dataSourceId } });
  } catch (err) {
    return errorResponse(err);
  }
}
