import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/rbac/requirePermission";
import { reviewOwnership } from "@/modules/agent-identity/service";
import { errorResponse } from "@/modules/agent-identity/http";

/** IDENTITY-P0-13 — confirm the agent's current owners are still right. */
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requirePermission("agent.update");
    const { id } = await params;
    const result = await reviewOwnership(ctx.tenantId!, ctx.userId, id);
    return NextResponse.json({ ok: true, data: result });
  } catch (err) {
    return errorResponse(err);
  }
}
