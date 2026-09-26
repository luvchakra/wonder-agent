import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/rbac/requirePermission";
import { createIdentitySource, listIdentitySources } from "@/modules/integrations/service";
import { errorResponse } from "@/modules/integrations/http";

// INTEGRATION-P0-08 — the tenant's identity sources.
export async function GET() {
  try {
    const ctx = await requirePermission("integration.read");
    return NextResponse.json({ ok: true, data: await listIdentitySources(ctx.tenantId!) });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function POST(request: NextRequest) {
  try {
    const ctx = await requirePermission("integration.create");
    const body = (await request.json().catch(() => null)) ?? {};
    return NextResponse.json({ ok: true, data: await createIdentitySource(ctx.tenantId!, ctx.userId, body) }, { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}
