import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/rbac/requirePermission";
import { listRuntimeEvents } from "@/modules/runtime-assurance/service";
import { errorResponse } from "@/modules/runtime-assurance/http";

/**
 * RUNTIME-P0-01.3 timeline query. Client-facing, gated by runtime.read —
 * runtime_events grants a client SELECT policy (migration 0032).
 */
export async function GET(request: NextRequest) {
  try {
    const ctx = await requirePermission("runtime.read");
    const params = request.nextUrl.searchParams;
    const page = await listRuntimeEvents(ctx.tenantId!, {
      agentId: params.get("agentId") ?? undefined,
      from: params.get("from") ?? undefined,
      to: params.get("to") ?? undefined,
      limit: params.get("limit") ? Number(params.get("limit")) : undefined,
      cursor: params.get("cursor") ?? undefined,
    });
    return NextResponse.json({ ok: true, data: page.events, nextCursor: page.nextCursor });
  } catch (err) {
    return errorResponse(err);
  }
}

// There is no POST here any more: agent activity reaches WonderID only
// through a connection's receiving side, /api/connect/v1/<connection>/events
// (non-negotiable #20).
