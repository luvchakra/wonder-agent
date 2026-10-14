import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/rbac/requirePermission";
import { reassignFulfilmentTask } from "@/modules/access-governance/service";
import { errorResponse } from "@/modules/access-governance/http";

/**
 * ACCESS-P0-42 — body `{ "identityId" | "groupId": id, "reason": string }`: hands the task to
 * another person or group. Its assignee, whoever claimed it, or an access manager (access.approve)
 * may; a claim is released. Audited; the new assignee is notified.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requirePermission("access.read");
    const { id } = await params;
    const body = ((await request.json().catch(() => null)) ?? {}) as { identityId?: unknown; groupId?: unknown; reason?: unknown };
    const task = await reassignFulfilmentTask(ctx.tenantId!, { userId: ctx.userId, canApprove: ctx.permissions.includes("access.approve") }, id, body);
    return NextResponse.json({ ok: true, data: task });
  } catch (err) {
    return errorResponse(err);
  }
}
