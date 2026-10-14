import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/rbac/requirePermission";
import { listRuleRuns } from "@/modules/operations/service";
import { errorResponse } from "@/modules/agent-identity/http";

// IDENTITY-P0-21 / OPERATIONS-P0-11 — a rule's latest runs (the automation run log).
export async function GET(request: NextRequest, { params }: { params: Promise<{ ruleId: string }> }) {
  try {
    const ctx = await requirePermission("identity.read");
    const { ruleId } = await params;
    const limit = Number(request.nextUrl.searchParams.get("limit") ?? 50);
    return NextResponse.json({ ok: true, data: await listRuleRuns(ctx.tenantId!, { ruleId, limit: Number.isFinite(limit) ? limit : 50 }) });
  } catch (err) {
    return errorResponse(err);
  }
}
