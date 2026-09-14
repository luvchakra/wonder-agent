import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/rbac/requirePermission";
import { createManualAccessGrant } from "@/modules/access-governance/service";
import { errorResponse } from "@/modules/access-governance/http";

export async function POST(request: Request) {
  try {
    const ctx = await requirePermission("access.manage");
    const body = await request.json();
    const grant = await createManualAccessGrant(
      ctx.tenantId!,
      ctx.userId,
      body.accountId,
      body.entitlementId,
      body.grantType,
    );
    return NextResponse.json({ ok: true, data: grant }, { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}
