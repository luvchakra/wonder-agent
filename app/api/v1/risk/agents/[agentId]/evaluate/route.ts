import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/rbac/requirePermission";
import { evaluateAgentRisk } from "@/modules/risk/service";
import { errorResponse } from "@/modules/risk/http";

export async function POST(_request: Request, { params }: { params: Promise<{ agentId: string }> }) {
  try {
    const ctx = await requirePermission("risk.manage");
    const { agentId } = await params;
    const findings = await evaluateAgentRisk(ctx.tenantId!, agentId);
    return NextResponse.json({ ok: true, data: findings });
  } catch (err) {
    return errorResponse(err);
  }
}
