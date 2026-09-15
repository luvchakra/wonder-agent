import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/rbac/requirePermission";
import { classifyActionsForAgent } from "@/modules/access-governance/service";
import { errorResponse } from "@/modules/access-governance/http";

// ACCESS-P0-06 — Action Governance's 4-state model (allowed /
// allowed_with_approval / restricted / prohibited), classified against the
// agent's active contract (Identity's IDENTITY-P0-07 fields). `?actions=`
// is a comma-separated list; omitted, classifies every action the
// contract itself names.
export async function GET(request: NextRequest, { params }: { params: Promise<{ agentId: string }> }) {
  try {
    await requirePermission("access.read");
    const { agentId } = await params;
    const actionsParam = request.nextUrl.searchParams.get("actions");
    const actions = actionsParam
      ? actionsParam.split(",").map((a) => a.trim()).filter(Boolean)
      : undefined;
    const results = await classifyActionsForAgent(agentId, actions);
    return NextResponse.json({ ok: true, data: results });
  } catch (err) {
    return errorResponse(err);
  }
}
