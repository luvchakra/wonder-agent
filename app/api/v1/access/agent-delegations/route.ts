import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/rbac/requirePermission";
import { listAgentDelegations, requestAgentDelegation } from "@/modules/access-governance/service";
import { errorResponse } from "@/modules/access-governance/http";

// ACCESS-P0-23 part 4 — delegations to AI agents: the caller's own, and those waiting for them as an agent owner.
export async function GET() {
  try {
    const ctx = await requirePermission("access.read");
    return NextResponse.json({ ok: true, data: await listAgentDelegations(ctx.tenantId!, { userId: ctx.userId, canManageAccess: ctx.permissions.includes("access.manage") }) });
  } catch (err) {
    return errorResponse(err);
  }
}

/** `{ delegateAgentId, actions, applications?, days?, reason, delegatorKind?: "user" | "agent", delegatorAgentId? }`. Waits for an owner of the agent. */
export async function POST(request: NextRequest) {
  try {
    const ctx = await requirePermission("access.read");
    const body = ((await request.json().catch(() => null)) ?? {}) as Record<string, unknown>;
    const data = await requestAgentDelegation(ctx.tenantId!, { userId: ctx.userId, canManageAccess: ctx.permissions.includes("access.manage") }, body);
    return NextResponse.json({ ok: true, data }, { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}
