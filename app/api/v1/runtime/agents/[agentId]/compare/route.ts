import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/rbac/requirePermission";
import { compareShouldCanDid } from "@/modules/runtime-assurance/service";
import { errorResponse } from "@/modules/runtime-assurance/http";

export async function GET(_request: Request, { params }: { params: Promise<{ agentId: string }> }) {
  try {
    const ctx = await requirePermission("runtime.read");
    const { agentId } = await params;
    const comparison = await compareShouldCanDid(ctx.tenantId!, agentId);
    return NextResponse.json({ ok: true, data: comparison });
  } catch (err) {
    return errorResponse(err);
  }
}
