import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/rbac/requirePermission";
import { ApiError } from "@/lib/shared/types/foundation";
import { endedRemoval, getRequestWithApprovals, grantsForRequest, listFulfilmentTasks, requestProgress, sweepApprovalTimeouts } from "@/modules/access-governance/service";
import { errorResponse } from "@/modules/access-governance/http";

/**
 * ACCESS-P0-19 — one request with its approval chain (every step, with who decided and why it asks whom).
 * ACCESS-P0-28/29/30 — and its grants and fulfilment tasks: `fulfilment` is pending_fulfilment, fulfilled_unverified, verified, or untracked.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requirePermission("access.read");
    const { id } = await params;
    // A step past its time is escalated or expired before it is shown.
    await sweepApprovalTimeouts(ctx.tenantId!);
    const found = await getRequestWithApprovals(ctx.tenantId!, id);
    if (!found) throw new ApiError(404, "REQUEST_NOT_FOUND");
    const [grants, tasks] = await Promise.all([grantsForRequest(ctx.tenantId!, id), listFulfilmentTasks(ctx.tenantId!, { requestId: id })]);
    return NextResponse.json({ ok: true, data: { ...found, grants, tasks, fulfilment: requestProgress(tasks, grants), removal: endedRemoval(grants) } });
  } catch (err) {
    return errorResponse(err);
  }
}
