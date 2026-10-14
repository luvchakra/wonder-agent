import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/rbac/requirePermission";
import { simulateIdentityRule } from "@/modules/agent-identity/service";
import { errorResponse } from "@/modules/agent-identity/http";

// IDENTITY-P0-21 — who the rule's working copy would change, and how. Changes nothing.
export async function POST(_request: NextRequest, { params }: { params: Promise<{ ruleId: string }> }) {
  try {
    const ctx = await requirePermission("identity.manage");
    const { ruleId } = await params;
    return NextResponse.json({ ok: true, data: await simulateIdentityRule(ctx.tenantId!, ctx.userId, ruleId) });
  } catch (err) {
    return errorResponse(err);
  }
}
