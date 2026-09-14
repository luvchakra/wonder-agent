import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/rbac/requirePermission";
import { addPolicyException, listPolicyExceptions } from "@/modules/access-governance/service";
import { errorResponse } from "@/modules/access-governance/http";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requirePermission("policy.read");
    const { id } = await params;
    const exceptions = await listPolicyExceptions(id);
    return NextResponse.json({ ok: true, data: exceptions });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requirePermission("policy.update");
    const { id } = await params;
    const body = await request.json();
    const exception = await addPolicyException(id, ctx.userId, body.reason, body.agentId, body.expiresAt);
    return NextResponse.json({ ok: true, data: exception }, { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}
