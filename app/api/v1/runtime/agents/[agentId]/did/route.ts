import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/rbac/requirePermission";
import { getDid } from "@/modules/runtime-assurance/service";
import { errorResponse } from "@/modules/runtime-assurance/http";

export async function GET(request: NextRequest, { params }: { params: Promise<{ agentId: string }> }) {
  try {
    const ctx = await requirePermission("runtime.read");
    const { agentId } = await params;
    const from = request.nextUrl.searchParams.get("from");
    const to = request.nextUrl.searchParams.get("to");
    const did = await getDid(ctx.tenantId!, agentId, from && to ? { from, to } : undefined);
    return NextResponse.json({ ok: true, data: did });
  } catch (err) {
    return errorResponse(err);
  }
}
