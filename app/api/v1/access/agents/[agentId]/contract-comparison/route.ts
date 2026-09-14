import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/rbac/requirePermission";
import { compareAccessToContract } from "@/modules/access-governance/service";
import { errorResponse } from "@/modules/access-governance/http";

// ACCESS-P0-04
export async function GET(_request: Request, { params }: { params: Promise<{ agentId: string }> }) {
  try {
    const ctx = await requirePermission("access.read");
    const { agentId } = await params;
    const rows = await compareAccessToContract(ctx.tenantId!, agentId);
    return NextResponse.json({ ok: true, data: rows });
  } catch (err) {
    return errorResponse(err);
  }
}
