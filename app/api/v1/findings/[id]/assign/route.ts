import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/rbac/requirePermission";
import { assignFinding } from "@/modules/risk/service";
import { errorResponse } from "@/modules/risk/http";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requirePermission("risk.manage");
    const { id } = await params;
    const body = await request.json();
    if (!body.assigneeId || typeof body.assigneeId !== "string") {
      return NextResponse.json({ ok: false, error: { code: "INVALID_INPUT", message: "assigneeId is required" } }, { status: 400 });
    }
    const finding = await assignFinding(ctx.tenantId!, ctx.userId, id, body.assigneeId);
    return NextResponse.json({ ok: true, data: finding });
  } catch (err) {
    return errorResponse(err);
  }
}
