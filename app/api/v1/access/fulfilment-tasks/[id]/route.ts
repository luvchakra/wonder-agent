import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/rbac/requirePermission";
import { actOnFulfilmentTask } from "@/modules/access-governance/service";
import { errorResponse } from "@/modules/access-governance/http";

/**
 * ACCESS-P0-29 — body `{ "action": "claim" | "complete" | "fail" | "retry_connector", "note"?: string }`.
 * INTEGRATION-P0-13: `retry_connector` asks the connector to try an open task it failed again.
 * The task's owner or an access manager (access.approve) may act; a failure needs a note. Audited.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requirePermission("access.read");
    const { id } = await params;
    const body = (await request.json().catch(() => null)) as { action?: unknown; note?: unknown } | null;
    const task = await actOnFulfilmentTask(ctx.tenantId!, { userId: ctx.userId, canApprove: ctx.permissions.includes("access.approve") }, id, body?.action, body?.note);
    return NextResponse.json({ ok: true, data: task });
  } catch (err) {
    return errorResponse(err);
  }
}
