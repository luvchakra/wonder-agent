import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/rbac/requirePermission";
import { createEntitlementType, listEntitlementTypes } from "@/modules/access-governance/service";
import { errorResponse } from "@/modules/access-governance/http";

/**
 * ACCESS-P0-33 — an application's entitlement types: how each is offered in
 * a request, whether it is certifiable, its default and maximum duration and
 * its approval route. Reading needs access.read; adding a type access.manage.
 */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requirePermission("access.read");
    const { id } = await params;
    return NextResponse.json({ ok: true, data: await listEntitlementTypes(ctx.tenantId!, id) });
  } catch (err) {
    return errorResponse(err);
  }
}

/** `{ name, requestMode?, certifiable?, defaultDurationDays?, maxDurationDays?, requestPolicyId? }` */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requirePermission("access.manage");
    const { id } = await params;
    const body = (await request.json().catch(() => null)) ?? {};
    return NextResponse.json({ ok: true, data: await createEntitlementType(ctx.tenantId!, ctx.userId, id, body) }, { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}
