import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/rbac/requirePermission";
import { setEntitlementGovernance } from "@/modules/access-governance/service";
import { errorResponse } from "@/modules/access-governance/http";

/**
 * ACCESS-P0-33 — a person sets an entitlement's type, requestable or
 * SOX-relevant flag: `{ entitlementType?, requestable?, soxRelevant? }`.
 * Recorded as a person's decision, which classification rules never override.
 */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requirePermission("access.manage");
    const { id } = await params;
    const body = (await request.json().catch(() => null)) ?? {};
    return NextResponse.json({ ok: true, data: await setEntitlementGovernance(ctx.tenantId!, ctx.userId, id, body) });
  } catch (err) {
    return errorResponse(err);
  }
}
