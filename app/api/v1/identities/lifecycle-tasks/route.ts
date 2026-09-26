import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/rbac/requirePermission";
import { listLifecycleTasks } from "@/modules/agent-identity/service";
import { errorResponse } from "@/modules/agent-identity/http";

// IDENTITY-P0-18 — the organization's lifecycle work queue.
export async function GET(request: NextRequest) {
  try {
    const ctx = await requirePermission("identity.read");
    const status = request.nextUrl.searchParams.get("status");
    return NextResponse.json({
      ok: true,
      data: await listLifecycleTasks(ctx.tenantId!, { status: status === "done" || status === "skipped" ? status : status === "all" ? undefined : "open" }),
    });
  } catch (err) {
    return errorResponse(err);
  }
}
