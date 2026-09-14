import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/rbac/requirePermission";
import { getPolicy, updatePolicy } from "@/modules/access-governance/service";
import { errorResponse } from "@/modules/access-governance/http";
import type { UpdatePolicyInput } from "@/lib/shared/types/access-governance";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requirePermission("policy.read");
    const { id } = await params;
    const policy = await getPolicy(id);
    if (!policy) return NextResponse.json({ ok: false, error: { code: "POLICY_NOT_FOUND" } }, { status: 404 });
    return NextResponse.json({ ok: true, data: policy });
  } catch (err) {
    return errorResponse(err);
  }
}

// ACCESS-P0-05
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requirePermission("policy.update");
    const { id } = await params;
    const body = (await request.json()) as UpdatePolicyInput;
    const policy = await updatePolicy(ctx.tenantId!, ctx.userId, id, body);
    return NextResponse.json({ ok: true, data: policy });
  } catch (err) {
    return errorResponse(err);
  }
}
