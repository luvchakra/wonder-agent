import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/rbac/requirePermission";
import { listGovernanceChanges } from "@/modules/access-governance/service";
import { errorResponse } from "@/modules/access-governance/http";

// ACCESS-P0-35 — changes to governance objects waiting for a second person (?status=pending|approved|rejected|all).
export async function GET(request: NextRequest) {
  try {
    const ctx = await requirePermission("access.manage");
    return NextResponse.json({ ok: true, data: await listGovernanceChanges(ctx.tenantId!, { status: request.nextUrl.searchParams.get("status") ?? undefined }) });
  } catch (err) {
    return errorResponse(err);
  }
}
