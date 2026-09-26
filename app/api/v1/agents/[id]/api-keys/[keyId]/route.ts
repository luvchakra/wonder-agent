import { NextResponse } from "next/server";
import { requireAnyPermissionFor } from "@/lib/rbac/authorize";
import { agentResource } from "@/app/_shared/agentScope";
import { revokeAgentApiKey } from "@/lib/security/agentApiKeys";
import { errorResponse } from "@/lib/shared/apiError";

// FOUNDATION-P0-17. Revocation is open to the agent's administrators
// (agent.update) and to incident responders (runtime.emergency).
export async function DELETE(request: Request, { params }: { params: Promise<{ id: string; keyId: string }> }) {
  try {
    const { id, keyId } = await params;
    const ctx = await requireAnyPermissionFor(["agent.update", "runtime.emergency"], agentResource(id));
    const body = (await request.json().catch(() => ({}))) as { reason?: unknown };
    const key = await revokeAgentApiKey(ctx.tenantId!, ctx.userId, id, keyId, typeof body.reason === "string" ? body.reason : "");
    return NextResponse.json({ ok: true, data: key });
  } catch (err) {
    return errorResponse(err);
  }
}
