import { NextResponse } from "next/server";
import { reviewOwnership } from "@/modules/agent-identity/service";
import { errorResponse } from "@/modules/agent-identity/http";
import { requirePermissionFor } from "@/lib/rbac/authorize";
import { agentResource } from "@/app/_shared/agentScope";

/** IDENTITY-P0-13 — confirm the agent's current owners are still right. */
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const ctx = await requirePermissionFor("agent.update", agentResource(id));
    const result = await reviewOwnership(ctx.tenantId!, ctx.userId, id);
    return NextResponse.json({ ok: true, data: result });
  } catch (err) {
    return errorResponse(err);
  }
}
