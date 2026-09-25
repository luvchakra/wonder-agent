import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/rbac/requirePermission";
import { endIdentityRelationship } from "@/modules/agent-identity/service";
import { errorResponse } from "@/modules/agent-identity/http";

// Ends a current relationship (sets valid_to); the history is kept.
export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ relationshipId: string }> }) {
  try {
    const ctx = await requirePermission("identity.manage");
    const { relationshipId } = await params;
    await endIdentityRelationship(ctx.tenantId!, ctx.userId, relationshipId);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return errorResponse(err);
  }
}
