import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/rbac/requirePermission";
import { submitRequestBasket } from "@/modules/access-governance/service";
import { errorResponse } from "@/modules/access-governance/http";

/**
 * ACCESS-P0-38 — a request basket: `{ subjectIdentityIds: [..], lines: [{ applicationId, entitlementId?,
 * requestType?, durationDays? }], justification }`. Every line for every person is its own request,
 * checked by the same rules as one sent alone; the answer reports each one (200 even when some are
 * refused, so the caller sees which and why).
 */
export async function POST(request: NextRequest) {
  try {
    const ctx = await requirePermission("access.request");
    const body = ((await request.json().catch(() => null)) ?? {}) as Record<string, unknown>;
    const data = await submitRequestBasket(ctx.tenantId!, { userId: ctx.userId, canManageAccess: ctx.permissions.includes("access.manage") }, body);
    return NextResponse.json({ ok: true, data });
  } catch (err) {
    return errorResponse(err);
  }
}
