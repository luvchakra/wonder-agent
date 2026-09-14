import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/rbac/requirePermission";
import { getEffectiveAccess } from "@/modules/access-governance/service";
import { errorResponse } from "@/modules/access-governance/http";

export async function GET(_request: Request, { params }: { params: Promise<{ agentId: string }> }) {
  try {
    const ctx = await requirePermission("access.read");
    const { agentId } = await params;
    const grants = await getEffectiveAccess(ctx.tenantId!, agentId);
    return NextResponse.json({ ok: true, data: grants });
  } catch (err) {
    return errorResponse(err);
  }
}
