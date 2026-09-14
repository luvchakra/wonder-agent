import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/rbac/requirePermission";
import { getFindings } from "@/modules/risk/service";
import { errorResponse } from "@/modules/risk/http";
import type { FindingStatus, RiskSeverity, RogueCategory } from "@/lib/shared/types/risk";

export async function GET(request: NextRequest) {
  try {
    const ctx = await requirePermission("risk.read");
    const params = request.nextUrl.searchParams;
    const findings = await getFindings(ctx.tenantId!, {
      agentId: params.get("agentId") ?? undefined,
      status: (params.get("status") as FindingStatus) ?? undefined,
      category: (params.get("category") as RogueCategory) ?? undefined,
      severity: (params.get("severity") as RiskSeverity) ?? undefined,
    });
    return NextResponse.json({ ok: true, data: findings });
  } catch (err) {
    return errorResponse(err);
  }
}
