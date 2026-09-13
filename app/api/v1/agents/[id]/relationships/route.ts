import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/rbac/requirePermission";
import { addRelationship, listRelationships, removeRelationship } from "@/modules/agent-identity/service";
import { errorResponse } from "@/modules/agent-identity/http";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requirePermission("agent.read");
    const { id } = await params;
    const relationships = await listRelationships(ctx.tenantId!, id);
    return NextResponse.json({ ok: true, data: relationships });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requirePermission("agent.update");
    const { id } = await params;
    const body = await request.json();
    const relationship = await addRelationship(
      ctx.tenantId!,
      id,
      body.relatedAgentId,
      body.relationshipType,
    );
    return NextResponse.json({ ok: true, data: relationship }, { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const ctx = await requirePermission("agent.update");
    const relationshipId = request.nextUrl.searchParams.get("relationshipId");
    if (!relationshipId) {
      return NextResponse.json(
        { ok: false, error: { code: "INVALID_INPUT", message: "relationshipId is required" } },
        { status: 400 },
      );
    }
    await removeRelationship(ctx.tenantId!, relationshipId);
    return NextResponse.json({ ok: true, data: null });
  } catch (err) {
    return errorResponse(err);
  }
}
