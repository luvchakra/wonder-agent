import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/rbac/requirePermission";
import { getAccessGraph } from "@/modules/access-governance/service";
import { errorResponse } from "@/modules/access-governance/http";

// ACCESS-P0-03
export async function GET(_request: Request, { params }: { params: Promise<{ agentId: string }> }) {
  try {
    const ctx = await requirePermission("access.read");
    const { agentId } = await params;
    const graph = await getAccessGraph(ctx.tenantId!, agentId);
    return NextResponse.json({ ok: true, data: graph });
  } catch (err) {
    return errorResponse(err);
  }
}
