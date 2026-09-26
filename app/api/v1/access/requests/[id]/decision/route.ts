import { NextResponse } from "next/server";
import { requireAnyPermission } from "@/lib/rbac/requirePermission";
import { ApiError } from "@/lib/shared/types/foundation";
import { decideAccessRequest, decideApprovalStep, getRequestWithApprovals } from "@/modules/access-governance/service";
import { errorResponse } from "@/modules/access-governance/http";

/**
 * A decision on an access request.
 * - An agent's request (ACCESS-P0-06): approve / reject / fulfil with
 *   `access.approve`, under separation of duties.
 * - A catalog request (ACCESS-P0-18/19): approve or reject one step of its
 *   approval chain. Whoever the step names may decide it — a manager or an
 *   owner needs no approver role — or an access manager (`access.approve`)
 *   for a step open to access managers. Marking it fulfilled needs
 *   `access.approve`. `{ decision, comment? }`.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireAnyPermission(["access.approve", "access.request", "access.read"]);
    const { id } = await params;
    const body = (await request.json().catch(() => ({}))) as { decision?: unknown; comment?: unknown };
    const canApprove = ctx.permissions.includes("access.approve");
    const found = await getRequestWithApprovals(ctx.tenantId!, id);
    if (!found) throw new ApiError(404, "REQUEST_NOT_FOUND");
    if (found.request.subjectIdentityId && (body.decision === "approved" || body.decision === "rejected")) {
      const { request: updated, step } = await decideApprovalStep(ctx.tenantId!, { userId: ctx.userId, roles: ctx.roles, canApproveAsAccessManager: canApprove }, id, body.decision, body.comment);
      return NextResponse.json({ ok: true, data: updated, meta: { step } });
    }
    if (!canApprove) throw new ApiError(403, "FORBIDDEN", "Missing permission: access.approve");
    const updated = await decideAccessRequest(ctx.tenantId!, ctx.userId, id, body.decision as never);
    return NextResponse.json({ ok: true, data: updated });
  } catch (err) {
    return errorResponse(err);
  }
}
