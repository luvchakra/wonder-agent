import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/rbac/requirePermission";
import { decideAccessRequest } from "@/modules/access-governance/service";
import { errorResponse } from "@/modules/access-governance/http";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requirePermission("access.approve");
    const { id } = await params;
    const body = await request.json();
    const updated = await decideAccessRequest(ctx.tenantId!, ctx.userId, id, body.decision);
    return NextResponse.json({ ok: true, data: updated });
  } catch (err) {
    return errorResponse(err);
  }
}
