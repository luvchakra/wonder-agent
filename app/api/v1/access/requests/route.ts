import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/rbac/requirePermission";
import {
  createAccessRequest,
  listAccessRequests,
  listRequestIdsAwaiting,
  listRequests,
  repairApprovalChains,
  submitAccessRequest,
  sweepApprovalTimeouts,
} from "@/modules/access-governance/service";
import { errorResponse } from "@/modules/access-governance/http";

export async function GET(request: NextRequest) {
  try {
    const ctx = await requirePermission("access.read");
    const p = request.nextUrl.searchParams;
    // ACCESS-P0-18: ?mine=1 (the caller's own requests) or ?view=all, with
    // subject and item names, paged at the database. Without either, the
    // original agent-request listing (optionally ?agentId=).
    // ACCESS-P0-19: ?view=waiting — what the caller may decide now.
    if (p.get("view") === "waiting") {
      const canApprove = ctx.permissions.includes("access.approve");
      await sweepApprovalTimeouts(ctx.tenantId!);
      await repairApprovalChains(ctx.tenantId!, ctx.userId);
      const ids = await listRequestIdsAwaiting(ctx.tenantId!, { userId: ctx.userId, canApproveAsAccessManager: canApprove });
      const list = await listRequests(ctx.tenantId!, { awaiting: { ids, pendingAgentRequests: canApprove }, page: Number(p.get("page")) || 1 });
      return NextResponse.json({ ok: true, data: list.rows, meta: { total: list.total } });
    }
    if (p.get("mine") === "1" || p.get("view") === "all") {
      const list = await listRequests(ctx.tenantId!, {
        mineUserId: p.get("mine") === "1" ? ctx.userId : undefined,
        status: p.get("status") ?? undefined,
        page: Number(p.get("page")) || 1,
      });
      return NextResponse.json({ ok: true, data: list.rows, meta: { total: list.total } });
    }
    const requests = await listAccessRequests(ctx.tenantId!, p.get("agentId") ?? undefined);
    return NextResponse.json({ ok: true, data: requests });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function POST(request: Request) {
  try {
    const ctx = await requirePermission("access.request");
    const body = await request.json();
    // ACCESS-P0-18: a request for a person or other identity goes through
    // the request catalog's policy; an agent request keeps its own path.
    if (!body.agentId) {
      const { request: created, duplicate } = await submitAccessRequest(ctx.tenantId!, { userId: ctx.userId, canManageAccess: ctx.permissions.includes("access.manage") }, body);
      return NextResponse.json({ ok: true, data: created, meta: { duplicate } }, { status: duplicate ? 200 : 201 });
    }
    const accessRequest = await createAccessRequest(
      ctx.tenantId!,
      ctx.userId,
      body.agentId,
      body.applicationId,
      body.entitlementId,
      body.justification,
    );
    return NextResponse.json({ ok: true, data: accessRequest }, { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}
