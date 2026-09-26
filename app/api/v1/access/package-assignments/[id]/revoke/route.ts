import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/rbac/requirePermission";
import { revokeAssignment } from "@/modules/access-governance/service";
import { errorResponse } from "@/modules/access-governance/http";

/** ACCESS-P0-20 — revoke a package assignment `{ reason }`: its fulfilled access becomes revocation work. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requirePermission("access.manage");
    const { id } = await params;
    const body = (await request.json().catch(() => ({}))) as { reason?: unknown };
    return NextResponse.json({ ok: true, data: await revokeAssignment(ctx.tenantId!, ctx.userId, id, body.reason) });
  } catch (err) {
    return errorResponse(err);
  }
}
