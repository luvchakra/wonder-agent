import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/rbac/requirePermission";
import { assignInvestigation, getInvestigation } from "@/modules/risk/service";
import { errorResponse } from "@/modules/risk/http";
import { ApiError } from "@/lib/shared/types/foundation";

/** RISK-P0-11 — one investigation with its findings and timeline; PATCH assigns it. */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requirePermission("risk.read");
    const { id } = await params;
    const data = await getInvestigation(ctx.tenantId!, id);
    if (!data) throw new ApiError(404, "INVESTIGATION_NOT_FOUND");
    return NextResponse.json({ ok: true, data });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requirePermission("risk.manage");
    const { id } = await params;
    const body = (await request.json().catch(() => ({}))) as { assigneeId?: unknown };
    if (!("assigneeId" in body)) throw new ApiError(400, "VALIDATION_FAILED", "assigneeId: required (a user id, or null to unassign)");
    const assigneeId = body.assigneeId === null ? null : String(body.assigneeId);
    return NextResponse.json({ ok: true, data: await assignInvestigation(ctx.tenantId!, ctx.userId, id, assigneeId) });
  } catch (err) {
    return errorResponse(err);
  }
}
