import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/rbac/requirePermission";
import { createEntitlement, listEntitlementsForApplication } from "@/modules/access-governance/service";
import { errorResponse } from "@/modules/access-governance/http";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requirePermission("access.read");
    const { id } = await params;
    const entitlements = await listEntitlementsForApplication(ctx.tenantId!, id);
    return NextResponse.json({ ok: true, data: entitlements });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requirePermission("access.manage");
    const { id } = await params;
    const body = await request.json();
    const entitlement = await createEntitlement(
      ctx.tenantId!,
      id,
      body.name,
      body.dataClassification,
      body.privilegeLevel,
    );
    return NextResponse.json({ ok: true, data: entitlement }, { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}
