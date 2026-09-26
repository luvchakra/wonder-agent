import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/rbac/requirePermission";
import { createAgentApiKey, listAgentApiKeys } from "@/lib/security/agentApiKeys";
import { errorResponse } from "@/lib/shared/apiError";
import { requirePermissionFor } from "@/lib/rbac/authorize";
import { agentResource } from "@/app/_shared/agentScope";

// FOUNDATION-P0-17. Thin wrappers over Foundation's agent-API-key
// primitive. The sub-route lives under the agent it belongs to; the
// primitive and table are Foundation's (docs/design/ownership-map.md).

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requirePermission("agent.read");
    const { id } = await params;
    return NextResponse.json({ ok: true, data: await listAgentApiKeys(ctx.tenantId!, id) });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const ctx = await requirePermissionFor("agent.update", agentResource(id));
    const body = (await request.json().catch(() => ({}))) as { name?: unknown; expiresAt?: unknown };
    const { key, secret } = await createAgentApiKey(ctx.tenantId!, ctx.userId, id, {
      name: typeof body.name === "string" ? body.name : "",
      expiresAt: typeof body.expiresAt === "string" ? body.expiresAt : null,
    });
    // The secret is in this one response and nowhere else, so it must not
    // be cached by anything between here and the caller.
    return NextResponse.json({ ok: true, data: { key, secret } }, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    return errorResponse(err);
  }
}
