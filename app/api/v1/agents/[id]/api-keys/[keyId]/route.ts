import { NextResponse } from "next/server";
import { requireAnyPermission } from "@/lib/rbac/requirePermission";
import { revokeAgentApiKey } from "@/lib/security/agentApiKeys";
import { errorResponse } from "@/lib/shared/apiError";

// FOUNDATION-P0-17. Revocation is open to the agent's administrators
// (agent.update) and to incident responders (runtime.emergency).
export async function DELETE(request: Request, { params }: { params: Promise<{ id: string; keyId: string }> }) {
  try {
    const ctx = await requireAnyPermission(["agent.update", "runtime.emergency"]);
    const { id, keyId } = await params;
    const body = (await request.json().catch(() => ({}))) as { reason?: unknown };
    const key = await revokeAgentApiKey(ctx.tenantId!, ctx.userId, id, keyId, typeof body.reason === "string" ? body.reason : "");
    return NextResponse.json({ ok: true, data: key });
  } catch (err) {
    return errorResponse(err);
  }
}
