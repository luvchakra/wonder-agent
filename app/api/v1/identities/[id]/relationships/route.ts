import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/rbac/requirePermission";
import { addIdentityRelationship, listIdentityRelationships } from "@/modules/agent-identity/service";
import { errorResponse } from "@/modules/agent-identity/http";

// IDENTITY-P0-16 — relationships of one identity. POST makes it the source.
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requirePermission("identity.read");
    const { id } = await params;
    return NextResponse.json({ ok: true, data: await listIdentityRelationships(ctx.tenantId!, id) });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requirePermission("identity.manage");
    const { id } = await params;
    const body = (await request.json().catch(() => null)) ?? {};
    const relationship = await addIdentityRelationship(ctx.tenantId!, ctx.userId, {
      sourceIdentityId: id,
      targetIdentityId: body.targetIdentityId,
      relationshipType: body.relationshipType,
      validTo: body.validTo,
    });
    return NextResponse.json({ ok: true, data: relationship }, { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}
