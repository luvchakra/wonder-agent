import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/rbac/requirePermission";
import { assignRogueFinding } from "@/modules/risk/service";
import { errorResponse } from "@/modules/risk/http";

/** RISK-P0-13: gives a rogue-access finding an owner. `{ assigneeId: <member user id> | null }`. `risk.manage`; audited. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requirePermission("risk.manage");
    const { id } = await params;
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const assigneeId = typeof body.assigneeId === "string" && body.assigneeId ? body.assigneeId : null;
    const data = await assignRogueFinding(ctx.tenantId!, ctx.userId, id, assigneeId);
    return NextResponse.json({ ok: true, data });
  } catch (err) {
    return errorResponse(err);
  }
}
