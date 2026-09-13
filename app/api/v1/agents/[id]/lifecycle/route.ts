import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/rbac/requirePermission";
import { listLifecycleEvents, transitionAgentLifecycle } from "@/modules/agent-identity/service";
import { errorResponse } from "@/modules/agent-identity/http";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requirePermission("agent.read");
    const { id } = await params;
    const events = await listLifecycleEvents(ctx.tenantId!, id);
    return NextResponse.json({ ok: true, data: events });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requirePermission("agent.update");
    const { id } = await params;
    const body = await request.json();
    const agent = await transitionAgentLifecycle(ctx.tenantId!, id, body.toState, body.reason, {
      actorType: "user",
      actorId: ctx.userId,
      roles: ctx.roles,
    });
    return NextResponse.json({ ok: true, data: agent });
  } catch (err) {
    return errorResponse(err);
  }
}
