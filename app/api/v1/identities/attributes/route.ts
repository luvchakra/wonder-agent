import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/rbac/requirePermission";
import { createAttributeDefinition, listAttributeDefinitions } from "@/modules/agent-identity/service";
import { errorResponse } from "@/modules/agent-identity/http";

// IDENTITY-P0-16 — the tenant's identity attribute definitions.
export async function GET() {
  try {
    const ctx = await requirePermission("identity.read");
    return NextResponse.json({ ok: true, data: await listAttributeDefinitions(ctx.tenantId!) });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function POST(request: NextRequest) {
  try {
    const ctx = await requirePermission("identity.manage");
    const body = (await request.json().catch(() => null)) ?? {};
    return NextResponse.json({ ok: true, data: await createAttributeDefinition(ctx.tenantId!, ctx.userId, body) }, { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}
