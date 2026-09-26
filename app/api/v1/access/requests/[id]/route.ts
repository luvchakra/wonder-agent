import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/rbac/requirePermission";
import { ApiError } from "@/lib/shared/types/foundation";
import { getRequestWithApprovals, sweepApprovalTimeouts } from "@/modules/access-governance/service";
import { errorResponse } from "@/modules/access-governance/http";

/** ACCESS-P0-19 — one request with its approval chain (every step, with who decided and why it asks whom). */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requirePermission("access.read");
    const { id } = await params;
    // A step past its time is escalated or expired before it is shown.
    await sweepApprovalTimeouts(ctx.tenantId!);
    const found = await getRequestWithApprovals(ctx.tenantId!, id);
    if (!found) throw new ApiError(404, "REQUEST_NOT_FOUND");
    return NextResponse.json({ ok: true, data: found });
  } catch (err) {
    return errorResponse(err);
  }
}
