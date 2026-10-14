import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/rbac/requirePermission";
import { listBasketRequests } from "@/modules/access-governance/service";
import { errorResponse } from "@/modules/access-governance/http";

// ACCESS-P0-38 — a basket's requests, as the caller can see them.
export async function GET(_request: NextRequest, { params }: { params: Promise<{ basketId: string }> }) {
  try {
    const ctx = await requirePermission("access.read");
    const { basketId } = await params;
    return NextResponse.json({ ok: true, data: await listBasketRequests(ctx.tenantId!, basketId) });
  } catch (err) {
    return errorResponse(err);
  }
}
