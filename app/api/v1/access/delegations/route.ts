import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/rbac/requirePermission";
import { createDelegation, listDelegations } from "@/modules/access-governance/service";
import { errorResponse } from "@/modules/access-governance/http";

// ACCESS-P0-23 — approver delegations: the caller's own (given or received), or every one for an access manager.
export async function GET() {
  try {
    const ctx = await requirePermission("access.read");
    return NextResponse.json({ ok: true, data: await listDelegations(ctx.tenantId!) });
  } catch (err) {
    return errorResponse(err);
  }
}

/** `{ delegateUserId, endsAt, startsAt?, reason?, delegatorUserId? }`; another person's approvals only for an access manager. */
export async function POST(request: NextRequest) {
  try {
    const ctx = await requirePermission("access.read");
    const body = ((await request.json().catch(() => null)) ?? {}) as Record<string, unknown>;
    const data = await createDelegation(ctx.tenantId!, { userId: ctx.userId, canManageAccess: ctx.permissions.includes("access.manage") }, body);
    return NextResponse.json({ ok: true, data }, { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}
