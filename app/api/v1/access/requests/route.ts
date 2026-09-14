import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/rbac/requirePermission";
import { createAccessRequest, listAccessRequests } from "@/modules/access-governance/service";
import { errorResponse } from "@/modules/access-governance/http";

export async function GET(request: NextRequest) {
  try {
    const ctx = await requirePermission("access.read");
    const agentId = request.nextUrl.searchParams.get("agentId") ?? undefined;
    const requests = await listAccessRequests(ctx.tenantId!, agentId);
    return NextResponse.json({ ok: true, data: requests });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function POST(request: Request) {
  try {
    const ctx = await requirePermission("access.request");
    const body = await request.json();
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
