import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/rbac/requirePermission";
import { createAgent, listAgents } from "@/modules/agent-identity/service";
import { errorResponse } from "@/modules/agent-identity/http";
import type { AgentFilter } from "@/lib/shared/types/agent-identity";

export async function GET(request: NextRequest) {
  try {
    const ctx = await requirePermission("agent.read");
    const searchParams = request.nextUrl.searchParams;
    const filter: AgentFilter = {};
    const status = searchParams.get("status");
    if (status === "discovered_unregistered") filter.status = status;
    const lifecycleState = searchParams.get("lifecycleState");
    if (lifecycleState) filter.lifecycleState = lifecycleState as AgentFilter["lifecycleState"];

    const agents = await listAgents(ctx.tenantId!, filter);
    return NextResponse.json({ ok: true, data: agents });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function POST(request: NextRequest) {
  try {
    const ctx = await requirePermission("agent.create");
    const body = await request.json();
    const result = await createAgent(ctx.tenantId!, ctx.userId, body);
    if (result.kind === "duplicate_candidate") {
      // 202 Accepted: the request was understood but registration is
      // pending human review (IDENTITY-P0-04) rather than complete.
      return NextResponse.json({ ok: true, data: result }, { status: 202 });
    }
    return NextResponse.json({ ok: true, data: result.agent }, { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}
