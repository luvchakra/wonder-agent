import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/rbac/requirePermission";
import { requestPackage } from "@/modules/access-governance/service";
import { errorResponse } from "@/modules/access-governance/http";

/**
 * ACCESS-P0-20 — request a package for yourself or someone else:
 * `{ subjectIdentityId?, durationDays?, justification }`. 201 with the
 * waiting request; 200 with meta.duplicate for one already waiting.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requirePermission("access.request");
    const { id } = await params;
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const { request: created, duplicate } = await requestPackage(ctx.tenantId!, { userId: ctx.userId, canManageAccess: ctx.permissions.includes("access.manage") }, { ...body, packageId: id });
    return NextResponse.json({ ok: true, data: created, meta: { duplicate } }, { status: duplicate ? 200 : 201 });
  } catch (err) {
    return errorResponse(err);
  }
}
