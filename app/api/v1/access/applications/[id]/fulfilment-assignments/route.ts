import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/rbac/requirePermission";
import { listFulfilmentAssignments, removeFulfilmentAssignment, setFulfilmentAssignment } from "@/modules/access-governance/service";
import { errorResponse } from "@/modules/access-governance/http";

// ACCESS-P0-42 — who does this application's fulfilment tasks. Reading needs access.read; setting access.manage.
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requirePermission("access.read");
    const { id } = await params;
    return NextResponse.json({ ok: true, data: await listFulfilmentAssignments(ctx.tenantId!, id) });
  } catch (err) {
    return errorResponse(err);
  }
}

/** `{ entitlementType?, identityId | groupId }`: sets the application's (or one entitlement type's) assignee, replacing the previous one. */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requirePermission("access.manage");
    const { id } = await params;
    const body = ((await request.json().catch(() => null)) ?? {}) as Record<string, unknown>;
    return NextResponse.json({ ok: true, data: await setFulfilmentAssignment(ctx.tenantId!, ctx.userId, id, body) });
  } catch (err) {
    return errorResponse(err);
  }
}

/** `?assignmentId=`: back to the default route (the owners). */
export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requirePermission("access.manage");
    const { id } = await params;
    await removeFulfilmentAssignment(ctx.tenantId!, ctx.userId, id, request.nextUrl.searchParams.get("assignmentId") ?? "");
    return NextResponse.json({ ok: true, data: null });
  } catch (err) {
    return errorResponse(err);
  }
}
