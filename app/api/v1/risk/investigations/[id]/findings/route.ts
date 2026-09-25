import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/rbac/requirePermission";
import { addFindingToInvestigation, removeFindingFromInvestigation } from "@/modules/risk/service";
import { errorResponse } from "@/modules/risk/http";

/** RISK-P0-11 — add (POST) or remove (DELETE) a finding: `{ findingId }`. */
async function handle(request: Request, params: Promise<{ id: string }>, remove: boolean) {
  try {
    const ctx = await requirePermission("risk.manage");
    const { id } = await params;
    const body = (await request.json().catch(() => ({}))) as { findingId?: unknown };
    const findingId = String(body.findingId ?? "");
    if (remove) await removeFindingFromInvestigation(ctx.tenantId!, ctx.userId, id, findingId);
    else await addFindingToInvestigation(ctx.tenantId!, ctx.userId, id, findingId);
    return NextResponse.json({ ok: true, data: { investigationId: id, findingId } }, { status: remove ? 200 : 201 });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(request, params, false);
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(request, params, true);
}
