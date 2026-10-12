import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/rbac/requirePermission";
import { setAgentGatewayOnly } from "@/modules/agent-identity/service";
import { errorResponse } from "@/modules/agent-identity/http";

/**
 * WID-C03 — turns "gateway only" on or off for an agent: `{ enabled }`.
 * Arming an automatic suspension is an emergency control, so it needs
 * `runtime.emergency`.
 */
export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requirePermission("runtime.emergency");
    const { id } = await params;
    const body = (await request.json().catch(() => ({}))) as { enabled?: unknown };
    const agent = await setAgentGatewayOnly(ctx.tenantId!, ctx.userId, id, body.enabled);
    return NextResponse.json({ ok: true, data: agent });
  } catch (err) {
    return errorResponse(err);
  }
}
