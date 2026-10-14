import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/rbac/requirePermission";
import { retireIdentityRule } from "@/modules/agent-identity/service";
import { errorResponse } from "@/modules/agent-identity/http";

// IDENTITY-P0-21 — retires a rule: it stops running; its versions and run log stay.
export async function POST(_request: NextRequest, { params }: { params: Promise<{ ruleId: string }> }) {
  try {
    const ctx = await requirePermission("identity.manage");
    const { ruleId } = await params;
    return NextResponse.json({ ok: true, data: await retireIdentityRule(ctx.tenantId!, ctx.userId, ruleId) });
  } catch (err) {
    return errorResponse(err);
  }
}
