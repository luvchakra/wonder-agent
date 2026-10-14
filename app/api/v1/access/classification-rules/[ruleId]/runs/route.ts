import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/rbac/requirePermission";
import { listClassificationRuns } from "@/modules/access-governance/service";
import { errorResponse } from "@/modules/access-governance/http";

// ACCESS-P0-33 / OPERATIONS-P0-11 — a classification rule's latest runs.
export async function GET(request: NextRequest, { params }: { params: Promise<{ ruleId: string }> }) {
  try {
    const ctx = await requirePermission("access.read");
    const { ruleId } = await params;
    const limit = Number(request.nextUrl.searchParams.get("limit") ?? 50);
    return NextResponse.json({ ok: true, data: await listClassificationRuns(ctx.tenantId!, ruleId, Number.isFinite(limit) ? limit : 50) });
  } catch (err) {
    return errorResponse(err);
  }
}
