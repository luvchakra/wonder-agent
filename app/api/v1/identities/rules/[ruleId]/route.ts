import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/rbac/requirePermission";
import { getIdentityRule, updateIdentityRule } from "@/modules/agent-identity/service";
import { errorResponse } from "@/modules/agent-identity/http";
import { ApiError } from "@/lib/shared/types/foundation";

// IDENTITY-P0-21 — one attribute rule with its published versions; PATCH edits its working copy.
export async function GET(_request: NextRequest, { params }: { params: Promise<{ ruleId: string }> }) {
  try {
    const ctx = await requirePermission("identity.read");
    const { ruleId } = await params;
    const rule = await getIdentityRule(ctx.tenantId!, ruleId);
    if (!rule) throw new ApiError(404, "NOT_FOUND", "No such rule");
    return NextResponse.json({ ok: true, data: rule });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ ruleId: string }> }) {
  try {
    const ctx = await requirePermission("identity.manage");
    const { ruleId } = await params;
    const body = (await request.json().catch(() => null)) ?? {};
    return NextResponse.json({ ok: true, data: await updateIdentityRule(ctx.tenantId!, ctx.userId, ruleId, body) });
  } catch (err) {
    return errorResponse(err);
  }
}
