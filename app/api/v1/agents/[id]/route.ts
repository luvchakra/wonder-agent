import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/rbac/requirePermission";
import { getAgent } from "@/modules/agent-identity/service";
import { errorResponse } from "@/modules/agent-identity/http";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requirePermission("agent.read");
    const { id } = await params;
    const agent = await getAgent(ctx.tenantId!, id);
    if (!agent) {
      return NextResponse.json({ ok: false, error: { code: "AGENT_NOT_FOUND" } }, { status: 404 });
    }
    return NextResponse.json({ ok: true, data: agent });
  } catch (err) {
    return errorResponse(err);
  }
}
