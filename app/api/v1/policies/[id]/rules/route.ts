import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/rbac/requirePermission";
import { addPolicyRule, listPolicyRules } from "@/modules/access-governance/service";
import { errorResponse } from "@/modules/access-governance/http";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requirePermission("policy.read");
    const { id } = await params;
    const rules = await listPolicyRules(id, ctx.tenantId!);
    return NextResponse.json({ ok: true, data: rules });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requirePermission("policy.update");
    const { id } = await params;
    const body = await request.json();
    const rule = await addPolicyRule(ctx.tenantId!, id, body.ruleType, body.condition);
    return NextResponse.json({ ok: true, data: rule }, { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}
