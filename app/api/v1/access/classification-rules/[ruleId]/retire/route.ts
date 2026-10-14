import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/rbac/requirePermission";
import { retireClassificationRule } from "@/modules/access-governance/service";
import { errorResponse } from "@/modules/access-governance/http";

// ACCESS-P0-33 — retires a rule: it stops running; its versions and run log stay.
export async function POST(_request: NextRequest, { params }: { params: Promise<{ ruleId: string }> }) {
  try {
    const ctx = await requirePermission("access.manage");
    const { ruleId } = await params;
    return NextResponse.json({ ok: true, data: await retireClassificationRule(ctx.tenantId!, ctx.userId, ruleId) });
  } catch (err) {
    return errorResponse(err);
  }
}
