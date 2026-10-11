import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/rbac/requirePermission";
import { listFulfilmentTasks } from "@/modules/access-governance/service";
import { errorResponse } from "@/modules/access-governance/http";

/** ACCESS-P0-29 — the organization's fulfilment tasks: `?view=all`, or the ones still to do (default), soonest due first. */
export async function GET(request: Request) {
  try {
    const ctx = await requirePermission("access.read");
    const url = new URL(request.url);
    const view = url.searchParams.get("view") === "all" ? "all" : "todo";
    const requestId = url.searchParams.get("requestId") ?? undefined;
    return NextResponse.json({ ok: true, data: await listFulfilmentTasks(ctx.tenantId!, { view, requestId }) });
  } catch (err) {
    return errorResponse(err);
  }
}
