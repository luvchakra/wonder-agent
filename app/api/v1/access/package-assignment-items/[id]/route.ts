import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/rbac/requirePermission";
import { setAssignmentItemStatus } from "@/modules/access-governance/service";
import { errorResponse } from "@/modules/access-governance/http";

/**
 * ACCESS-P0-20 — record one work item's outcome in the target system:
 * `{ status: fulfilled | failed | pending | revoked, detail? }` (a failure
 * needs a detail). With `access.approve`, as for marking a request
 * fulfilled; the provisioning pipeline (INTEGRATION-P0-13) takes this over.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requirePermission("access.approve");
    const { id } = await params;
    const body = (await request.json().catch(() => ({}))) as { status?: unknown; detail?: unknown };
    return NextResponse.json({ ok: true, data: await setAssignmentItemStatus(ctx.tenantId!, ctx.userId, id, body.status, body.detail) });
  } catch (err) {
    return errorResponse(err);
  }
}
