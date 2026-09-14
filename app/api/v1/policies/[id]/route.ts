import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/rbac/requirePermission";
import { getPolicy } from "@/modules/access-governance/service";
import { errorResponse } from "@/modules/access-governance/http";

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
