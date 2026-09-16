import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/rbac/requirePermission";
import { getFindingAsOfDetection } from "@/modules/risk/service";
import { errorResponse } from "@/modules/risk/http";

/**
 * RUNTIME-P0-13's real caller for `compareShouldCanDid(..., asOf)`. Read-only
 * investigation surface — never used by the deterministic evaluation loop
 * itself (`evaluateAgentRisk()` always scores current state), only for a
 * reviewer to see what CAN looked like when a finding was first detected.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requirePermission("risk.read");
    const { id } = await params;
    const result = await getFindingAsOfDetection(ctx.tenantId!, id);
    if (!result) return NextResponse.json({ ok: false, error: { code: "FINDING_NOT_FOUND" } }, { status: 404 });
    return NextResponse.json({ ok: true, data: result });
  } catch (err) {
    return errorResponse(err);
  }
}
