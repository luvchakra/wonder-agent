import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/rbac/requirePermission";
import { createPolicy, listPolicies } from "@/modules/access-governance/service";
import { errorResponse } from "@/modules/access-governance/http";

export async function GET() {
  try {
    const ctx = await requirePermission("policy.read");
    const policies = await listPolicies(ctx.tenantId!);
    return NextResponse.json({ ok: true, data: policies });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function POST(request: Request) {
  try {
    const ctx = await requirePermission("policy.create");
    const body = await request.json();
    const policy = await createPolicy(ctx.tenantId!, body);
    return NextResponse.json({ ok: true, data: policy }, { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}
