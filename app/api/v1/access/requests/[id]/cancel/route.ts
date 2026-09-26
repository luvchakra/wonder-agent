import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/rbac/requirePermission";
import { cancelAccessRequest } from "@/modules/access-governance/service";
import { errorResponse } from "@/modules/access-governance/http";

// ACCESS-P0-18 — the requester withdraws a request that is still waiting.
export async function POST(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requirePermission("access.request");
    const { id } = await params;
    return NextResponse.json({ ok: true, data: await cancelAccessRequest(ctx.tenantId!, ctx.userId, id) });
  } catch (err) {
    return errorResponse(err);
  }
}
