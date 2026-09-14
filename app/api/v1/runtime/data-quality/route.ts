import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/rbac/requirePermission";
import { getDataQualityMetrics } from "@/modules/runtime-assurance/service";
import { errorResponse } from "@/modules/runtime-assurance/http";

// RUNTIME-P0-14
export async function GET(request: NextRequest) {
  try {
    const ctx = await requirePermission("runtime.read");
    const agentId = request.nextUrl.searchParams.get("agentId") ?? undefined;
    const metrics = await getDataQualityMetrics(ctx.tenantId!, agentId);
    return NextResponse.json({ ok: true, data: metrics });
  } catch (err) {
    return errorResponse(err);
  }
}
