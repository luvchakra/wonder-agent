import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/rbac/requirePermission";
import { assignOwner, listOwners } from "@/modules/agent-identity/service";
import { errorResponse } from "@/modules/agent-identity/http";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requirePermission("agent.read");
    const { id } = await params;
    const owners = await listOwners(ctx.tenantId!, id);
    return NextResponse.json({ ok: true, data: owners });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requirePermission("agent.update");
    const { id } = await params;
    const body = await request.json();
    const owner = await assignOwner(ctx.tenantId!, id, body.ownerType, body.userId, ctx.userId);
    return NextResponse.json({ ok: true, data: owner }, { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}
