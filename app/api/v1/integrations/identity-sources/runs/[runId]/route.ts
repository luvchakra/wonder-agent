import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/rbac/requirePermission";
import { getReconciliationRun } from "@/modules/integrations/service";
import { errorResponse } from "@/modules/integrations/http";

export async function GET(_request: NextRequest, { params }: { params: Promise<{ runId: string }> }) {
  try {
    const ctx = await requirePermission("integration.read");
    const { runId } = await params;
    const run = await getReconciliationRun(ctx.tenantId!, runId);
    if (!run) return NextResponse.json({ ok: false, error: { code: "NOT_FOUND", message: "No such run" } }, { status: 404 });
    return NextResponse.json({ ok: true, data: run });
  } catch (err) {
    return errorResponse(err);
  }
}
