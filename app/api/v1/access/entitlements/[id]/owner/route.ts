import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/rbac/requirePermission";
import { assertUuid } from "@/lib/security/validate";
import { setEntitlementOwner } from "@/modules/access-governance/service";
import { errorResponse } from "@/modules/access-governance/http";

/** ACCESS-P0-19 — the person who approves requests for this entitlement; `{ ownerIdentityId: null }` clears it. */
export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requirePermission("access.manage");
    const { id } = await params;
    assertUuid(id, "id");
    const body = (await request.json().catch(() => ({}))) as { ownerIdentityId?: unknown };
    const ownerIdentityId = body.ownerIdentityId === null ? null : String(body.ownerIdentityId ?? "");
    if (ownerIdentityId !== null) assertUuid(ownerIdentityId, "ownerIdentityId");
    const entitlement = await setEntitlementOwner(ctx.tenantId!, ctx.userId, id, ownerIdentityId);
    return NextResponse.json({ ok: true, data: entitlement });
  } catch (err) {
    return errorResponse(err);
  }
}
